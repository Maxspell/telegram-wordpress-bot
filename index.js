#!/usr/bin/env node

const TelegramBot = require('./bot');
const logger = require('./utils/logger');
const WordPressAPI = require('./services/wordpressAPI');

// Обработка необработанных исключений
process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Функция проверки окружения
function validateEnvironment() {
    const requiredVars = [
        'BOT_TOKEN',
        'WORDPRESS_URL',
        'WP_API_KEY',
        'WP_API_SECRET'
    ];

    const missing = requiredVars.filter(varName => !process.env[varName]);
    
    if (missing.length > 0) {
        logger.error('Missing required environment variables:', missing);
        console.error('❌ Missing required environment variables:');
        missing.forEach(varName => {
            console.error(`   - ${varName}`);
        });
        console.error('\nPlease check your .env file or environment variables.');
        process.exit(1);
    }

    logger.info('Environment validation passed');
}

// Функция проверки подключения к WordPress
async function checkWordPressConnection() {
    try {
        logger.info('Checking WordPress API connection...');
        const wpAPI = new WordPressAPI();
        const isHealthy = await wpAPI.healthCheck();
        
        if (!isHealthy) {
            throw new Error('WordPress API health check failed');
        }
        
        logger.info('✅ WordPress API connection successful');
        return true;
    } catch (error) {
        logger.error('❌ WordPress API connection failed:', error.message);
        console.error('Failed to connect to WordPress API. Please check:');
        console.error('- WordPress URL is correct and accessible');
        console.error('- API credentials are valid');
        console.error('- WordPress plugin is installed and activated');
        return false;
    }
}

// Основная функция запуска
async function main() {
    try {
        console.log('🚀 Starting Telegram Bot...\n');
        
        // Проверяем окружение
        validateEnvironment();
        
        // Проверяем подключение к WordPress
        const wpConnected = await checkWordPressConnection();
        
        if (!wpConnected) {
            console.log('\n⚠️  Warning: WordPress connection failed, but bot will start anyway.');
            console.log('   Make sure to fix WordPress connection for full functionality.\n');
        }
        
        // Создаем и запускаем бота
        const bot = new TelegramBot();
        
        // Добавляем обработчики завершения работы
        const gracefulShutdown = (signal) => {
            logger.info(`Received ${signal}, shutting down gracefully...`);
            console.log(`\n📴 Received ${signal}, shutting down gracefully...`);
            
            bot.bot.stop(signal)
                .then(() => {
                    logger.info('Bot stopped successfully');
                    console.log('✅ Bot stopped successfully');
                    process.exit(0);
                })
                .catch((error) => {
                    logger.error('Error stopping bot:', error);
                    console.error('❌ Error stopping bot:', error.message);
                    process.exit(1);
                });
        };

        process.on('SIGINT', () => gracefulShutdown('SIGINT'));
        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        
        // Запускаем бота
        bot.start();
        
        // Выводим информацию о запуске
        console.log('✅ Bot started successfully!');
        console.log('📊 Monitoring:');
        console.log(`   - Logs: ./logs/combined.log`);
        console.log(`   - Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`   - Process ID: ${process.pid}`);
        console.log('\n🔄 Bot is running... Press Ctrl+C to stop\n');
        
        // Периодическая проверка здоровья системы
        setInterval(async () => {
            try {
                const wpAPI = new WordPressAPI();
                const isHealthy = await wpAPI.healthCheck();
                
                if (!isHealthy) {
                    logger.warn('WordPress API health check failed during runtime');
                }
            } catch (error) {
                logger.warn('Health check error:', error.message);
            }
        }, 5 * 60 * 1000); // Каждые 5 минут

    } catch (error) {
        logger.error('Failed to start bot:', error);
        console.error('❌ Failed to start bot:', error.message);
        process.exit(1);
    }
}

// Запускаем приложение
if (require.main === module) {
    main().catch(error => {
        logger.error('Startup error:', error);
        console.error('❌ Startup error:', error.message);
        process.exit(1);
    });
}

module.exports = { main };