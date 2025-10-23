import pino from 'pino';

let logger: pino.Logger | null = null;

export const getLogger = (): pino.Logger => {
    if (logger) {
        return logger;
    }
    // @ts-ignore
    const sharedConfig = globalThis.__SOLIDSTEP_CONFIG__;
    const loggerConfig = sharedConfig?.logger;

    if (loggerConfig === false || loggerConfig === undefined) {
        logger = pino({ level: 'silent' });
    } else if (loggerConfig === true) {
        logger = pino();
    } else {
        logger = pino(loggerConfig);
    }
    return logger;
};
