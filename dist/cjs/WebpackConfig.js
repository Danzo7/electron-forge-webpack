"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const debug_1 = tslib_1.__importDefault(require("debug"));
const html_webpack_plugin_1 = tslib_1.__importDefault(require("html-webpack-plugin"));
const path_1 = tslib_1.__importDefault(require("path"));
const webpack_1 = tslib_1.__importDefault(require("webpack"));
const webpack_merge_1 = require("webpack-merge");
const AssetRelocatorPatch_1 = tslib_1.__importDefault(require("./util/AssetRelocatorPatch"));
const d = (0, debug_1.default)('electron-forge:plugin:webpack:webpackconfig');
class WebpackConfigGenerator {
    isProd;
    pluginConfig;
    port;
    projectDir;
    webpackDir;
    constructor(pluginConfig, projectDir, isProd, port) {
        this.pluginConfig = pluginConfig;
        this.projectDir = projectDir;
        this.webpackDir = path_1.default.resolve(projectDir, pluginConfig.output ?? '.webpack');
        this.isProd = isProd;
        this.port = port;
        d('Config mode:', this.mode);
    }
    resolveConfig(config) {
        if (typeof config === 'string') {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            return require(path_1.default.resolve(this.projectDir, config));
        }
        return config;
    }
    get mode() {
        return this.isProd ? 'production' : 'development';
    }
    get rendererSourceMapOption() {
        return this.isProd ? 'source-map' : 'eval-source-map';
    }
    get rendererTarget() {
        return this.pluginConfig.renderer.nodeIntegration
            ? 'electron-renderer'
            : 'web';
    }
    rendererEntryPoint(entryPoint, inRendererDir, basename) {
        if (this.isProd) {
            return `\`file://$\{require('path').resolve(__dirname, '..', '${inRendererDir ? 'renderer' : '.'}', '${!entryPoint.isMain ? entryPoint.name : ''}', '${basename}')}\``;
        }
        const baseUrl = `http://localhost:${this.port}/${!entryPoint.isMain ? entryPoint.name : ''}`;
        if (basename !== 'index.html') {
            return `'${baseUrl}/${basename}'`;
        }
        return `'${baseUrl}'`;
    }
    toEnvironmentVariable(entryPoint, preload = false) {
        const suffix = preload ? '_PRELOAD_WEBPACK_ENTRY' : '_WEBPACK_ENTRY';
        return `${entryPoint.name.toUpperCase().replace(/ /g, '_')}${suffix}`;
    }
    getPreloadDefine(entryPoint) {
        if (entryPoint.preload) {
            if (this.isProd) {
                return `require('path').resolve(__dirname, '../renderer', '${!entryPoint.isMain ? entryPoint.name : ''}', 'preload.js')`;
            }
            return `'${path_1.default
                .resolve(this.webpackDir, 'renderer', !entryPoint.isMain ? entryPoint.name : '', 'preload.js')
                .replace(/\\/g, '\\\\')}'`;
        }
        // If this entry-point has no configured preload script just map this constant to `undefined`
        // so that any code using it still works.  This makes quick-start / docs simpler.
        return 'undefined';
    }
    getDefines(inRendererDir = true) {
        const defines = {};
        if (!this.pluginConfig.renderer.entryPoints ||
            !Array.isArray(this.pluginConfig.renderer.entryPoints)) {
            throw new Error('Required config option "renderer.entryPoints" has not been defined');
        }
        for (const entryPoint of this.pluginConfig.renderer.entryPoints) {
            const entryKey = this.toEnvironmentVariable(entryPoint);
            if (entryPoint.html) {
                defines[entryKey] = this.rendererEntryPoint(entryPoint, inRendererDir, 'index.html');
            }
            else {
                defines[entryKey] = this.rendererEntryPoint(entryPoint, inRendererDir, 'index.js');
            }
            defines[`process.env.${entryKey}`] = defines[entryKey];
            const preloadDefineKey = this.toEnvironmentVariable(entryPoint, true);
            defines[preloadDefineKey] = this.getPreloadDefine(entryPoint);
            defines[`process.env.${preloadDefineKey}`] = defines[preloadDefineKey];
        }
        return defines;
    }
    getMainConfig() {
        const mainConfig = this.resolveConfig(this.pluginConfig.mainConfig);
        if (!mainConfig.entry) {
            throw new Error('Required option "mainConfig.entry" has not been defined');
        }
        const fix = (item) => {
            if (typeof item === 'string')
                return fix([item])[0];
            if (Array.isArray(item)) {
                return item.map((val) => val.startsWith('./') ? path_1.default.resolve(this.projectDir, val) : val);
            }
            const ret = {};
            for (const key of Object.keys(item)) {
                ret[key] = fix(item[key]);
            }
            return ret;
        };
        mainConfig.entry = fix(mainConfig.entry);
        return (0, webpack_merge_1.merge)({
            devtool: 'source-map',
            target: 'electron-main',
            mode: this.mode,
            output: {
                path: path_1.default.resolve(this.webpackDir, 'main'),
                filename: 'index.js',
                libraryTarget: 'commonjs2',
            },
            plugins: [new webpack_1.default.DefinePlugin(this.getDefines())],
            node: {
                __dirname: false,
                __filename: false,
            },
        }, mainConfig || {});
    }
    async getPreloadRendererConfig(parentPoint, entryPoint) {
        const rendererConfig = this.resolveConfig(entryPoint.config || this.pluginConfig.renderer.config);
        const prefixedEntries = entryPoint.prefixedEntries || [];
        return (0, webpack_merge_1.merge)({
            devtool: this.rendererSourceMapOption,
            mode: this.mode,
            entry: prefixedEntries.concat([entryPoint.js]),
            output: {
                path: path_1.default.resolve(this.webpackDir, 'renderer', parentPoint.name),
                filename: 'preload.js',
            },
            node: {
                __dirname: false,
                __filename: false,
            },
        }, rendererConfig || {}, { target: 'electron-preload' });
    }
    async getRendererConfig(entryPoints) {
        const rendererConfig = this.resolveConfig(this.pluginConfig.renderer.config);
        const entry = {};
        for (const entryPoint of entryPoints) {
            const prefixedEntries = entryPoint.prefixedEntries || [];
            entry[entryPoint.name] = prefixedEntries.concat([entryPoint.js]);
        }
        const defines = this.getDefines(false);
        const plugins = entryPoints
            .filter((entryPoint) => Boolean(!entryPoint.isMain && entryPoint.html))
            .map((entryPoint) => new html_webpack_plugin_1.default({
            title: entryPoint.name,
            template: entryPoint.html,
            filename: `${entryPoint.name}/index.html`,
            chunks: [entryPoint.name].concat(entryPoint.additionalChunks || []),
        }))
            .concat([
            new webpack_1.default.DefinePlugin(defines),
            new AssetRelocatorPatch_1.default(this.isProd, !!this.pluginConfig.renderer.nodeIntegration),
        ]);
        return (0, webpack_merge_1.merge)({
            entry,
            devtool: this.rendererSourceMapOption,
            target: this.rendererTarget,
            mode: this.mode,
            output: {
                path: path_1.default.resolve(this.webpackDir, 'renderer'),
                filename: 'index.js',
                globalObject: 'self',
                ...(this.isProd ? {} : { publicPath: '/' }),
            },
            node: {
                __dirname: false,
                __filename: false,
            },
            plugins,
        }, rendererConfig || {});
    }
}
exports.default = WebpackConfigGenerator;
//# sourceMappingURL=WebpackConfig.js.map