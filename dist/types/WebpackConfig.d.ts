import { Configuration } from 'webpack';
import { WebpackPluginConfig, WebpackPluginEntryPoint, WebpackPreloadEntryPoint } from './Config';
declare type WebpackMode = 'production' | 'development';
export default class WebpackConfigGenerator {
    private isProd;
    private pluginConfig;
    private port;
    private projectDir;
    private webpackDir;
    constructor(pluginConfig: WebpackPluginConfig, projectDir: string, isProd: boolean, port: number);
    resolveConfig(config: Configuration | string): Configuration;
    get mode(): WebpackMode;
    get rendererSourceMapOption(): string;
    get rendererTarget(): string;
    rendererEntryPoint(entryPoint: WebpackPluginEntryPoint, inRendererDir: boolean, basename: string): string;
    toEnvironmentVariable(entryPoint: WebpackPluginEntryPoint, preload?: boolean): string;
    getPreloadDefine(entryPoint: WebpackPluginEntryPoint): string;
    getDefines(inRendererDir?: boolean): Record<string, string>;
    getMainConfig(): Configuration;
    getPreloadRendererConfig(parentPoint: WebpackPluginEntryPoint, entryPoint: WebpackPreloadEntryPoint): Promise<Configuration>;
    getRendererConfig(entryPoints: WebpackPluginEntryPoint[]): Promise<Configuration>;
}
export {};
