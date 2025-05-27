const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

// Создаем директорию для логов если её нет
const fs = require('fs');
const logDir = 'logs';
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
}

// Настройка форматов логирования
const logFormat = winston.format.combine(
    winston.format.timestamp({
        format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    winston.format.json()
);

const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({
        format: 'HH:mm:ss'
    }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
        let msg = `${timestamp} [${level}]: ${message}`;
        
        // Добавляем дополнительные данные если есть
        if (Object.keys(meta).length > 0) {
            msg += '\n' + JSON.stringify(meta, null, 2);
        }
        
        return msg;
    })
);

// Создание логгера
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: logFormat,
    defaultMeta: { service: 'telegram-bot' },
    transports: [
        // Логи ошибок в отдельный файл
        new winston.transports.File({
            filename: path.join(logDir, 'error.log'),
            level: 'error',
            maxsize: 5242880, // 5MB
            maxFiles: 5
        }),
        
        // Все логи в общий файл
        new winston.transports.File({
            filename: path.join(logDir, 'combined.log'),
            maxsize: 5242880, // 5MB
            maxFiles: 10
        }),
        
        // Ротация логов по дням
        new DailyRotateFile({
            filename: path.join(logDir, 'application-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            zippedArchive: true,
            maxSize: '20m',
            maxFiles: '14d'
        })
    ],
    
    // Обработка необработанных исключений
    exceptionHandlers: [
        new winston.transports.File({
            filename: path.join(logDir, 'exceptions.log')
        })
    ],
    
    // Обработка необработанных отклонений промисов
    rejectionHandlers: [
        new winston.transports.File({
            filename: path.join(logDir, 'rejections.log')
        })
    ]
});

// В режиме разработки добавляем вывод в консоль
if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: consoleFormat,
        level: 'debug'
    }));
} else {
    // В продакшене добавляем консоль только для важных сообщений
    logger.add(new winston.transports.Console({
        format: consoleFormat,
        level: 'warn'
    }));
}

// Добавляем методы для специфичных типов логирования
logger.telegram = (userId, action, data = {}) => {
    logger.info('Telegram Activity', {
        userId,
        action,
        ...data,
        category: 'telegram'
    });
};

logger.api = (method, url, status, duration = null) => {
    logger.info('API Call', {
        method,
        url,
        status,
        duration,
        category: 'api'
    });
};

logger.security = (event, userId, details = {}) => {
    logger.warn('Security Event', {
        event,
        userId,
        ...details,
        category: 'security'
    });
};

logger.performance = (operation, duration, details = {}) => {
    const level = duration > 1000 ? 'warn' : 'info';
    logger.log(level, 'Performance', {
        operation,
        duration,
        ...details,
        category: 'performance'
    });
};

// Middleware для Express (если понадобится веб-интерфейс)
logger.expressMiddleware = (req, res, next) => {
    const start = Date.now();
    
    res.on('finish', () => {
        const duration = Date.now() - start;
        logger.api(req.method, req.url, res.statusCode, duration);
    });
    
    next();
};

module.exports = logger;