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
                await ctx.reply('Сталася помилка. Спробуйте пізніше або зверніться на підтримку.');
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
                '👋 Ласкаво просимо!\n\n' +
                'Я допоможу залишити заявку. Для початку введіть ПІБ. \n' +
                'Наприклад: Шевченко Тарас Григорович',
                {
                    reply_markup: {
                        keyboard: [['❌ Скасувати']],
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
        this.bot.hears('❌ Скасувати', async (ctx) => {
            await this.cancelProcess(ctx);
        });

        // Команда помощи
        this.bot.help(async (ctx) => {
            await ctx.reply(
                '🆘 *Допомога*\n\n' +
                '/start - Почати заповнення анкети\n' +
                '/cancel - Скасувати поточний процес\n' +
                '/help - Показати це повідомлення\n' +
                '/status - Перевірити статус заявки',
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
            case 'awaiting_age':
                await this.handleAgeInput(ctx, text);
                break;
            case 'awaiting_phone':
                await this.handlePhoneInput(ctx, text);
                break;
            case 'awaiting_education':
                await this.handleEducationInput(ctx, text);
                break;
            case 'awaiting_vacancy':
                await this.handleVacancyInput(ctx, text);
                break;
            case 'awaiting_message':
                await this.handleMessageInput(ctx, text);
                break;
            default:
                await ctx.reply(
                    'Для початку роботи використовуйте команду /start\n' +
                    'Для отримання допомоги - /help'
                );
        }
    }

    async handleNameInput(ctx, name) {
        if (!this.validationService.validateName(name)) {
            ctx.session.attempts++;
            
            if (ctx.session.attempts >= 3) {
                await this.cancelProcess(ctx, 'Перевищено кількість спроб. Спробуйте пізніше.');
                return;
            }

            await ctx.reply(
                "❌ Будь ласка, введіть коректне ім'я (лише літери, щонайменше 2 символи).\n" +
                `Попытка ${ctx.session.attempts} из 3.`
            );
            return;
        }

        ctx.session.userData.name = name;
        ctx.session.step = 'awaiting_age';
        ctx.session.attempts = 0;

        await ctx.reply(
            '📱 Чудово!\n\n' + 
            'Тепер введіть ваш вік.\n',
            {
                reply_markup: {
                    keyboard: [
                        ['❌ Скасувати']
                    ],
                    resize_keyboard: true,
                    one_time_keyboard: false
                }
            }
        );
    }

    async handleAgeInput(ctx, age) {
        ctx.session.userData.age = age;
        ctx.session.step = 'awaiting_phone';
        ctx.session.attempts = 0;

        await ctx.reply(
            '📱 Чудово!\n\n' + 
            'Тепер введіть номер телефону.\n' +
            'Формат: +380XXXXXXXXX или 0XXXXXXXXX',
            {
                reply_markup: {
                    keyboard: [
                        ['❌ Скасувати']
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
                await this.cancelProcess(ctx, 'Перевищено кількість спроб. Спробуйте пізніше.');
                return;
            }

            await ctx.reply(
                '❌ Будь ласка, введіть номер телефону.\n' +
                'Формат: +380XXXXXXXXX или 0XXXXXXXXX\n' +
                `Спроба ${ctx.session.attempts} з 3.`
            );
            return;
        }

        ctx.session.userData.phone = this.validationService.normalizePhone(phone);
        ctx.session.step = 'awaiting_education';
        ctx.session.attempts = 0;

        await ctx.reply(
            "💬 Чудово!\n" +
            'Яка у вас освіта?',
            {
                reply_markup: {
                    keyboard: [['❌ Скасувати']],
                    resize_keyboard: true
                }
            }
        );
    }

    async handleEducationInput(ctx, education) {
        ctx.session.userData.education = education;
        ctx.session.step = 'awaiting_vacancy';
        ctx.session.attempts = 0;

        await ctx.reply(
            "💬 Чудово!\n" +
            'Яка вакансія вас цікавить?',
            {
                reply_markup: {
                    keyboard: [['❌ Скасувати']],
                    resize_keyboard: true
                }
            }
        );
    }

    async handleEducationInput(ctx, vacancy) {
        ctx.session.userData.vacancy = vacancy;
        ctx.session.step = 'awaiting_message';
        ctx.session.attempts = 0;

        await ctx.reply(
            "💬 Напишіть ваше повідомлення чи запитання (необов'язково).\n" +
            'Можете написати "пропустити" щоб завершити:',
            {
                reply_markup: {
                    keyboard: [['Пропустити'], ['❌ Скасувати']],
                    resize_keyboard: true
                }
            }
        );
    }

    async handleMessageInput(ctx, message) {
        if (message.toLowerCase() !== 'пропустити') {
            if (message.length > 1000) {
                await ctx.reply('❌ Повідомлення надто довге. Максимум 1000 символів.');
                return;
            }
            ctx.session.userData.message = message;
        }

        await this.submitData(ctx);
    }

    async submitData(ctx) {
        try {
            await ctx.reply('⏳ Надсилаю дані...');

            // Отправка данных в WordPress
            const result = await this.wpAPI.submitUserData(ctx.session.userData);
            
            if (result.success) {
                await ctx.reply(
                    '✅ *Дякую! Вашу заявку успішно відправлено.*\n\n' +
                    `📋 ID заявки: ${result.id}\n` +
                    '📞 Ми зв\'яжемося з вами найближчим часом.\n\n' +
                    'Для подання нової заявки використовуйте /start',
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
                '❌ Сталася помилка під час надсилання даних.\n' +
                'Спробуйте пізніше або зверніться у підтримку.',
                { reply_markup: { remove_keyboard: true } }
            );
        }

        // Сброс сессии
        ctx.session.step = 'idle';
        ctx.session.userData = {};
        ctx.session.attempts = 0;
    }

    async cancelProcess(ctx, message = 'Процес скасовано.') {
        ctx.session.step = 'idle';
        ctx.session.userData = {};
        ctx.session.attempts = 0;

        await ctx.reply(
            message + '\n\nДля початку роботи використовуйте /start',
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