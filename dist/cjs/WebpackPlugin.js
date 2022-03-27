"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
/* eslint "no-console": "off" */
const async_ora_1 = require("@electron-forge/async-ora");
const plugin_base_1 = tslib_1.__importDefault(require("@electron-forge/plugin-base"));
const web_multi_logger_1 = tslib_1.__importDefault(require("@electron-forge/web-multi-logger"));
const chalk_1 = tslib_1.__importDefault(require("chalk"));
const debug_1 = tslib_1.__importDefault(require("debug"));
const fs_extra_1 = tslib_1.__importDefault(require("fs-extra"));
const webpack_merge_1 = require("webpack-merge");
const path_1 = tslib_1.__importDefault(require("path"));
const core_1 = require("@electron-forge/core");
const webpack_1 = tslib_1.__importDefault(require("webpack"));
const webpack_dev_server_1 = tslib_1.__importDefault(require("webpack-dev-server"));
const ElectronForgeLogging_1 = tslib_1.__importDefault(require("./util/ElectronForgeLogging"));
const once_1 = tslib_1.__importDefault(require("./util/once"));
const WebpackConfig_1 = tslib_1.__importDefault(require("./WebpackConfig"));
const d = (0, debug_1.default)('electron-forge:plugin:webpack');
const DEFAULT_PORT = 3000;
const DEFAULT_LOGGER_PORT = 9000;
class WebpackPlugin extends plugin_base_1.default {
    name = 'webpack';
    isProd = false;
    // The root of the Electron app
    projectDir;
    // Where the Webpack output is generated. Usually `$projectDir/.webpack`
    baseDir;
    _configGenerator;
    watchers = [];
    servers = [];
    loggers = [];
    port = DEFAULT_PORT;
    loggerPort = DEFAULT_LOGGER_PORT;
    output;
    constructor(c) {
        super(c);
        if (c.port) {
            if (this.isValidPort(c.port)) {
                this.port = c.port;
            }
        }
        if (c.loggerPort) {
            if (this.isValidPort(c.loggerPort)) {
                this.loggerPort = c.loggerPort;
            }
        }
        this.startLogic = this.startLogic.bind(this);
        this.getHook = this.getHook.bind(this);
        this.output = c.output ?? '.webpack';
    }
    isValidPort = (port) => {
        if (port < 1024) {
            throw new Error(`Cannot specify port (${port}) below 1024, as they are privileged`);
        }
        else if (port > 65535) {
            throw new Error(`Port specified (${port}) is not a valid TCP port.`);
        }
        else {
            return true;
        }
    };
    exitHandler = (options, err) => {
        d('handling process exit with:', options);
        if (options.cleanup) {
            for (const watcher of this.watchers) {
                d('cleaning webpack watcher');
                watcher.close(() => {
                    /* Do nothing when the watcher closes */
                });
            }
            this.watchers = [];
            for (const server of this.servers) {
                d('cleaning http server');
                server.close();
            }
            this.servers = [];
            for (const logger of this.loggers) {
                d('stopping logger');
                logger.stop();
            }
            this.loggers = [];
        }
        if (err)
            console.error(err.stack);
        // Why: This is literally what the option says to do.
        // eslint-disable-next-line no-process-exit
        if (options.exit)
            process.exit();
    };
    async writeJSONStats(type, stats, statsOptions) {
        if (!stats)
            return;
        d(`Writing JSON stats for ${type} config`);
        const jsonStats = stats.toJson(statsOptions);
        const jsonStatsFilename = path_1.default.resolve(this.baseDir, type, 'stats.json');
        await fs_extra_1.default.writeJson(jsonStatsFilename, jsonStats, { spaces: 2 });
    }
    // eslint-disable-next-line max-len
    runWebpack = async (options, isRenderer = false) => new Promise((resolve, reject) => {
        (0, webpack_1.default)(options).run(async (err, stats) => {
            if (isRenderer && this.config.renderer.jsonStats) {
                await this.writeJSONStats('renderer', stats, options.stats);
            }
            if (err) {
                return reject(err);
            }
            return resolve(stats);
        });
    });
    init = (dir) => {
        this.setDirectories(dir);
        d('hooking process events');
        process.on('exit', (_code) => this.exitHandler({ cleanup: true }));
        process.on('SIGINT', (_signal) => this.exitHandler({ exit: true }));
    };
    setDirectories = (dir) => {
        this.projectDir = dir;
        this.baseDir = path_1.default.resolve(dir, this.output);
    };
    get configGenerator() {
        // eslint-disable-next-line no-underscore-dangle
        if (!this._configGenerator) {
            // eslint-disable-next-line no-underscore-dangle
            this._configGenerator = new WebpackConfig_1.default(this.config, this.projectDir, this.isProd, this.port);
        }
        // eslint-disable-next-line no-underscore-dangle
        return this._configGenerator;
    }
    loggedOutputUrl = false;
    getHook(name) {
        switch (name) {
            case 'prePackage':
                this.isProd = true;
                return async (config, platform, arch) => {
                    await fs_extra_1.default.remove(this.baseDir);
                    await core_1.utils.rebuildHook(this.projectDir, await core_1.utils.getElectronVersion(this.projectDir, await fs_extra_1.default.readJson(path_1.default.join(this.projectDir, 'package.json'))), platform, arch, config.electronRebuildConfig);
                    await this.compileMain();
                    await this.compileRenderers();
                };
            case 'postStart':
                return async (_config, child) => {
                    if (!this.loggedOutputUrl) {
                        console.info(`\n\nWebpack Output Available: ${chalk_1.default.cyan(`http://localhost:${this.loggerPort}`)}\n`);
                        this.loggedOutputUrl = true;
                    }
                    d('hooking electron process exit');
                    child.on('exit', () => {
                        if (child.restarted)
                            return;
                        this.exitHandler({ cleanup: true, exit: true });
                    });
                };
            case 'resolveForgeConfig':
                return this.resolveForgeConfig;
            case 'packageAfterCopy':
                return this.packageAfterCopy;
            default:
                return null;
        }
    }
    resolveForgeConfig = async (forgeConfig) => {
        if (!forgeConfig.packagerConfig) {
            forgeConfig.packagerConfig = {};
        }
        if (forgeConfig.packagerConfig.ignore) {
            if (typeof forgeConfig.packagerConfig.ignore !== 'function') {
                console.error(chalk_1.default.red(`You have set packagerConfig.ignore, the Electron Forge webpack plugin normally sets this automatically.

Your packaged app may be larger than expected if you dont ignore everything other than the ${this.output} folder`));
            }
            return forgeConfig;
        }
        forgeConfig.packagerConfig.ignore = (file) => {
            if (!file)
                return false;
            if (this.config.jsonStats &&
                file.endsWith(path_1.default.join(this.output, 'main', 'stats.json'))) {
                return true;
            }
            if (this.config.renderer.jsonStats &&
                file.endsWith(path_1.default.join(this.output, 'renderer', 'stats.json'))) {
                return true;
            }
            return !new RegExp('^[/\\\\]' + this.output + '($|[/\\\\]).*$').test(file);
        };
        return forgeConfig;
    };
    packageAfterCopy = async (_forgeConfig, buildPath) => {
        const pj = await fs_extra_1.default.readJson(path_1.default.resolve(this.projectDir, 'package.json'));
        if (!pj.main?.endsWith(this.output + '/main')) {
            throw new Error(`Electron Forge is configured to use the Webpack plugin. The plugin expects the
"main" entry point in "package.json" to be "${this.output}/main" (where the plugin outputs
the generated files). Instead, it is ${JSON.stringify(pj.main)}`);
        }
        if (pj.config) {
            delete pj.config.forge;
        }
        pj.devDependencies = {};
        pj.dependencies = {};
        pj.optionalDependencies = {};
        pj.peerDependencies = {};
        await fs_extra_1.default.writeJson(path_1.default.resolve(buildPath, 'package.json'), pj, {
            spaces: 2,
        });
        await fs_extra_1.default.mkdirp(path_1.default.resolve(buildPath, 'node_modules'));
    };
    compileMain = async (watch = false, logger) => {
        let tab;
        if (logger) {
            tab = logger.createTab('Main Process');
        }
        await (0, async_ora_1.asyncOra)('Compiling Main Process Code', async () => {
            const mainConfig = this.configGenerator.getMainConfig();
            await new Promise((resolve, reject) => {
                const compiler = (0, webpack_1.default)(mainConfig);
                const [onceResolve, onceReject] = (0, once_1.default)(resolve, reject);
                const cb = async (err, stats) => {
                    if (tab && stats) {
                        tab.log(stats.toString({
                            colors: true,
                        }));
                    }
                    if (this.config.jsonStats) {
                        await this.writeJSONStats('main', stats, mainConfig.stats);
                    }
                    if (err)
                        return onceReject(err);
                    if (!watch && stats?.hasErrors()) {
                        return onceReject(new Error(`Compilation errors in the main process: ${stats.toString()}`));
                    }
                    return onceResolve(undefined);
                };
                if (watch) {
                    this.watchers.push(compiler.watch({}, cb));
                }
                else {
                    compiler.run(cb);
                }
            });
        });
    };
    compileRenderers = async (watch = false) => {
        await (0, async_ora_1.asyncOra)('Compiling Renderer Template', async () => {
            const stats = await this.runWebpack(await this.configGenerator.getRendererConfig(this.config.renderer.entryPoints), true);
            if (!watch && stats?.hasErrors()) {
                throw new Error(`Compilation errors in the renderer: ${stats.toString()}`);
            }
        });
        for (const entryPoint of this.config.renderer.entryPoints) {
            if (entryPoint.preload) {
                await (0, async_ora_1.asyncOra)(`Compiling Renderer Preload: ${entryPoint.name}`, async () => {
                    const stats = await this.runWebpack(
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    await this.configGenerator.getPreloadRendererConfig(entryPoint, entryPoint.preload));
                    if (stats?.hasErrors()) {
                        throw new Error(`Compilation errors in the preload (${entryPoint.name}): ${stats.toString()}`);
                    }
                });
            }
        }
    };
    launchDevServers = async (logger) => {
        await (0, async_ora_1.asyncOra)('Launch Dev Servers', async () => {
            const tab = logger.createTab('Renderers');
            const pluginLogs = new ElectronForgeLogging_1.default(tab);
            const config = await this.configGenerator.getRendererConfig(this.config.renderer.entryPoints);
            if (!config.plugins)
                config.plugins = [];
            config.plugins.push(pluginLogs);
            const compiler = (0, webpack_1.default)(config);
            const webpackDevServer = new webpack_dev_server_1.default(this.devServerOptions(), compiler);
            await webpackDevServer.start();
            if (webpackDevServer.server != undefined)
                this.servers.push(webpackDevServer.server);
        });
        await (0, async_ora_1.asyncOra)('Compiling Preload Scripts', async () => {
            for (const entryPoint of this.config.renderer.entryPoints) {
                if (entryPoint.preload) {
                    const config = await this.configGenerator.getPreloadRendererConfig(entryPoint, 
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    entryPoint.preload);
                    await new Promise((resolve, reject) => {
                        const tab = logger.createTab(`${entryPoint.name} - Preload`);
                        const [onceResolve, onceReject] = (0, once_1.default)(resolve, reject);
                        this.watchers.push((0, webpack_1.default)(config).watch({}, (err, stats) => {
                            if (stats) {
                                tab.log(stats.toString({
                                    colors: true,
                                }));
                            }
                            if (err)
                                return onceReject(err);
                            return onceResolve(undefined);
                        }));
                    });
                }
            }
        });
    };
    devServerOptions() {
        const cspDirectives = this.config.devContentSecurityPolicy ??
            "default-src 'self' 'unsafe-inline' data:; script-src 'self' 'unsafe-eval' 'unsafe-inline' data:";
        const defaults = {
            hot: true,
            devMiddleware: {
                writeToDisk: true,
            },
            historyApiFallback: true,
        };
        const overrides = {
            port: this.port,
            setupExitSignals: true,
            static: path_1.default.resolve(this.baseDir, 'renderer'),
            headers: {
                'Content-Security-Policy': cspDirectives,
            },
        };
        return (0, webpack_merge_1.merge)(defaults, this.config.devServer ?? {}, overrides);
    }
    alreadyStarted = false;
    async startLogic() {
        if (this.alreadyStarted)
            return false;
        this.alreadyStarted = true;
        await fs_extra_1.default.remove(this.baseDir);
        const logger = new web_multi_logger_1.default(this.loggerPort);
        this.loggers.push(logger);
        await this.compileMain(true, logger);
        await this.launchDevServers(logger);
        await logger.start();
        return false;
    }
}
exports.default = WebpackPlugin;
//# sourceMappingURL=WebpackPlugin.js.map