import { asyncOra } from '@electron-forge/async-ora';
import once from './once';
const pluginName = 'ElectronForgeLogging';
export default class LoggingPlugin {
    tab;
    promiseResolver;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    promiseRejector;
    constructor(tab) {
        this.tab = tab;
        this.promiseResolver = undefined;
        this.promiseRejector = undefined;
    }
    addRun() {
        if (this.promiseResolver)
            this.promiseResolver();
        asyncOra('Compiling Renderer Code', () => new Promise((resolve, reject) => {
            const [onceResolve, onceReject] = once(resolve, reject);
            this.promiseResolver = onceResolve;
            this.promiseRejector = onceReject;
        }), () => {
            /* do not exit */
        });
    }
    finishRun(error) {
        if (error && this.promiseRejector)
            this.promiseRejector(error);
        else if (this.promiseResolver)
            this.promiseResolver();
        this.promiseRejector = undefined;
        this.promiseResolver = undefined;
    }
    apply(compiler) {
        compiler.hooks.watchRun.tap(pluginName, (_compiler) => {
            this.addRun();
        });
        compiler.hooks.done.tap(pluginName, (stats) => {
            if (stats) {
                this.tab.log(stats.toString({
                    colors: true,
                }));
                if (stats.hasErrors()) {
                    this.finishRun(stats.compilation.getErrors().toString());
                    return;
                }
            }
            this.finishRun();
        });
        compiler.hooks.failed.tap(pluginName, (err) => this.finishRun(err.message));
        compiler.hooks.infrastructureLog.tap(pluginName, (name, _type, args) => {
            this.tab.log(`${name} - ${args.join(' ')}\n`);
            return true;
        });
    }
}
//# sourceMappingURL=ElectronForgeLogging.js.map