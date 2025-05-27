const { Telegraf, session } = require('telegraf');
const rateLimit = require('telegraf-ratelimit');
require('dotenv').config();

const logger = require('./utils/logger');
const UserController = require('./controllers/userController');
const ValidationService = require('./services/validationService');
const WordPressAPI = require('./services/wordpressAPI');

class TelegramBot {
    constructor() {
        this.bot = new Telegraf(process.env.BOT_TOKEN);
        this.userController = new UserController();
        this.validationService = new ValidationService();
        this.wpAPI = new WordPressAPI();
        
        this.setupMiddleware();
        this.setupHandlers();
    }

    setupMiddleware() {
        // Rate limiting
        const limitConfig = {
            window: 1000, // 1 секунда
            limit: 3, // 3 сообщения в секунду
            onLimitExceeded: (ctx) => {
                logger.warn(`Rate limit exceeded for user ${ctx.from.id}`);
                ctx.reply('Слишком много сообщений. Подождите немного.');
            }
        };
        
        this.bot.use(rateLimit(limitConfig));
        
        // Session middleware
        this.bot.use(session({
            defaultSession: () => ({
                step: 'idle',
                userData: {},
                attempts: 0
            })
        }));

        // Error handling middleware
        this.bot.use(async (ctx, next) => {
            try {
                await next();
            } catch (error) {
                logger.error('Bot error:', error);
                await ctx.reply('Произошла ошибка. Попробуйте позже или обратитесь в поддержку.');
            }
        });

        // Logging middleware
        this.bot.use((ctx, next) => {
            logger.info(`Message from ${ctx.from.id}: ${ctx.message?.text || 'non-text'}`);
            return next();
        });
    }

    setupHandlers() {
        // Команда /start
        this.bot.start(async (ctx) => {
            const user = ctx.from;
            logger.info(`User ${user.id} started bot`);
            
            ctx.session.step = 'awaiting_name';
            ctx.session.userData = {
                telegram_id: user.id,
                username: user.username || null,
                first_name: user.first_name || null,
                last_name: user.last_name || null
            };

            await ctx.reply(
                '👋 Добро пожаловать!\n\n' +
                'Я помогу вам оставить заявку. Для начала введите ваше полное имя:',
                {
                    reply_markup: {
                        keyboard: [['❌ Отмена']],
                        resize_keyboard: true,
                        one_time_keyboard: false
                    }
                }
            );
        });

        // Команда /cancel
        this.bot.command('cancel', async (ctx) => {
            await this.cancelProcess(ctx);
        });

        // Обработка кнопки отмены
        this.bot.hears('❌ Отмена', async (ctx) => {
            await this.cancelProcess(ctx);
        });

        // Команда помощи
        this.bot.help(async (ctx) => {
            await ctx.reply(
                '🆘 *Помощь*\n\n' +
                '/start - Начать заполнение анкеты\n' +
                '/cancel - Отменить текущий процесс\n' +
                '/help - Показать это сообщение\n' +
                '/status - Проверить статус заявки',
                { parse_mode: 'Markdown' }
            );
        });

        // Основной обработчик текстовых сообщений
        this.bot.on('text', async (ctx) => {
            await this.handleTextMessage(ctx);
        });

        // Обработка контактов
        this.bot.on('contact', async (ctx) => {
            if (ctx.session.step === 'awaiting_phone') {
                await this.handlePhoneInput(ctx, ctx.message.contact.phone_number);
            }
        });
    }

    async handleTextMessage(ctx) {
        const text = ctx.message.text.trim();
        const step = ctx.session.step;

        switch (step) {
            case 'awaiting_name':
                await this.handleNameInput(ctx, text);
                break;
            case 'awaiting_phone':
                await this.handlePhoneInput(ctx, text);
                break;
            case 'awaiting_email':
                await this.handleEmailInput(ctx, text);
                break;
            case 'awaiting_message':
                await this.handleMessageInput(ctx, text);
                break;
            default:
                await ctx.reply(
                    'Для начала работы используйте команду /start\n' +
                    'Для получения помощи - /help'
                );
        }
    }

    async handleNameInput(ctx, name) {
        if (!this.validationService.validateName(name)) {
            ctx.session.attempts++;
            
            if (ctx.session.attempts >= 3) {
                await this.cancelProcess(ctx, 'Превышено количество попыток. Попробуйте позже.');
                return;
            }

            await ctx.reply(
                '❌ Пожалуйста, введите корректное имя (только буквы, минимум 2 символа).\n' +
                `Попытка ${ctx.session.attempts} из 3.`
            );
            return;
        }

        ctx.session.userData.name = name;
        ctx.session.step = 'awaiting_phone';
        ctx.session.attempts = 0;

        await ctx.reply(
            '📱 Отлично! Теперь введите ваш номер телефона или поделитесь контактом:',
            {
                reply_markup: {
                    keyboard: [
                        [{ text: '📞 Поделиться контактом', request_contact: true }],
                        ['❌ Отмена']
                    ],
                    resize_keyboard: true,
                    one_time_keyboard: false
                }
            }
        );
    }

    async handlePhoneInput(ctx, phone) {
        if (!this.validationService.validatePhone(phone)) {
            ctx.session.attempts++;
            
            if (ctx.session.attempts >= 3) {
                await this.cancelProcess(ctx, 'Превышено количество попыток. Попробуйте позже.');
                return;
            }

            await ctx.reply(
                '❌ Пожалуйста, введите корректный номер телефона.\n' +
                'Формат: +7XXXXXXXXXX или 8XXXXXXXXXX\n' +
                `Попытка ${ctx.session.attempts} из 3.`
            );
            return;
        }

        ctx.session.userData.phone = this.validationService.normalizePhone(phone);
        ctx.session.step = 'awaiting_email';
        ctx.session.attempts = 0;

        await ctx.reply(
            '📧 Введите ваш email адрес:',
            {
                reply_markup: {
                    keyboard: [['❌ Отмена']],
                    resize_keyboard: true
                }
            }
        );
    }

    async handleEmailInput(ctx, email) {
        if (!this.validationService.validateEmail(email)) {
            ctx.session.attempts++;
            
            if (ctx.session.attempts >= 3) {
                await this.cancelProcess(ctx, 'Превышено количество попыток. Попробуйте позже.');
                return;
            }

            await ctx.reply(
                '❌ Пожалуйста, введите корректный email адрес.\n' +
                `Попытка ${ctx.session.attempts} из 3.`
            );
            return;
        }

        ctx.session.userData.email = email.toLowerCase();
        ctx.session.step = 'awaiting_message';
        ctx.session.attempts = 0;

        await ctx.reply(
            '💬 Напишите ваше сообщение или вопрос (необязательно).\n' +
            'Можете написать "пропустить" чтобы завершить:',
            {
                reply_markup: {
                    keyboard: [['Пропустить'], ['❌ Отмена']],
                    resize_keyboard: true
                }
            }
        );
    }

    async handleMessageInput(ctx, message) {
        if (message.toLowerCase() !== 'пропустить') {
            if (message.length > 1000) {
                await ctx.reply('❌ Сообщение слишком длинное. Максимум 1000 символов.');
                return;
            }
            ctx.session.userData.message = message;
        }

        await this.submitData(ctx);
    }

    async submitData(ctx) {
        try {
            await ctx.reply('⏳ Отправляю данные...');

            // Отправка данных в WordPress
            const result = await this.wpAPI.submitUserData(ctx.session.userData);
            
            if (result.success) {
                await ctx.reply(
                    '✅ *Спасибо! Ваша заявка успешно отправлена.*\n\n' +
                    `📋 ID заявки: ${result.id}\n` +
                    '📞 Мы свяжемся с вами в ближайшее время.\n\n' +
                    'Для подачи новой заявки используйте /start',
                    {
                        parse_mode: 'Markdown',
                        reply_markup: { remove_keyboard: true }
                    }
                );

                logger.info(`Successfully submitted data for user ${ctx.from.id}, submission ID: ${result.id}`);
            } else {
                throw new Error(result.error || 'Unknown error');
            }
        } catch (error) {
            logger.error('Error submitting data:', error);
            await ctx.reply(
                '❌ Произошла ошибка при отправке данных.\n' +
                'Попробуйте позже или обратитесь в поддержку.',
                { reply_markup: { remove_keyboard: true } }
            );
        }

        // Сброс сессии
        ctx.session.step = 'idle';
        ctx.session.userData = {};
        ctx.session.attempts = 0;
    }

    async cancelProcess(ctx, message = 'Процесс отменен.') {
        ctx.session.step = 'idle';
        ctx.session.userData = {};
        ctx.session.attempts = 0;

        await ctx.reply(
            message + '\n\nДля начала работы используйте /start',
            { reply_markup: { remove_keyboard: true } }
        );
    }

    start() {
        // Graceful shutdown
        process.once('SIGINT', () => {
            logger.info('Received SIGINT, stopping bot...');
            this.bot.stop('SIGINT');
        });
        
        process.once('SIGTERM', () => {
            logger.info('Received SIGTERM, stopping bot...');
            this.bot.stop('SIGTERM');
        });

        // Start bot
        this.bot.launch()
            .then(() => {
                logger.info('Bot started successfully');
                console.log('🤖 Bot is running...');
            })
            .catch(error => {
                logger.error('Failed to start bot:', error);
                process.exit(1);
            });
    }
}

module.exports = TelegramBot;