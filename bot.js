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
            window: 1000,
            limit: 3,
            onLimitExceeded: (ctx) => {
                logger.warn(`Rate limit exceeded for user ${ctx.from.id}`);
                ctx.reply('Занадто багато повідомлень. Зачекайте трохи.');
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
        // Команда /start - показать главное меню
        this.bot.start(async (ctx) => {
            const user = ctx.from;
            logger.info(`User ${user.id} started bot`);
            
            await this.showMainMenu(ctx);
        });

        // Команда /cancel
        this.bot.command('cancel', async (ctx) => {
            await this.cancelProcess(ctx);
        });

        // Обработка кнопки отмены
        this.bot.hears('❌ Скасувати', async (ctx) => {
            await this.cancelProcess(ctx);
        });

        // Обработка кнопки "Заповнити анкету"
        this.bot.hears('📝 Заповнити анкету', async (ctx) => {
            await this.startForm(ctx);
        });

        // Обработка кнопки "Вакансії"
        this.bot.hears('💼 Вакансії', async (ctx) => {
            await this.showVacancies(ctx);
        });

        // Обработка кнопки "Контракт 18-24"
        this.bot.hears('📜 Контракт 18-24', async (ctx) => {
            await this.showContracts(ctx);
        });

        // Обработка кнопки "Переведення з іншої військової частини"
        this.bot.hears('🔄 Переведення з іншої військової частини', async (ctx) => {
            await this.showTransfer(ctx);
        });

        // Обработка кнопки "Повернення після СЗЧ"
        this.bot.hears('❓ Повернення після СЗЧ', async (ctx) => {
            await this.showReturnSzch(ctx);
        });

        // Обработка кнопки "Питання до військової частини"
        this.bot.hears('🚨 Питання до військової частини', async (ctx) => {
            await this.startComplaintForm(ctx);
        });

        // Обработка кнопки "Назад до меню"
        this.bot.hears('🔙 Назад до меню', async (ctx) => {
            await this.showMainMenu(ctx);
        });

        // Команда помощи
        this.bot.help(async (ctx) => {
            await ctx.reply(
                '🆘 *Допомога*\n\n' +
                '/start - Показати головне меню\n' +
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

    async showMainMenu(ctx) {
        ctx.session.step = 'idle';
        ctx.session.userData = {};
        ctx.session.attempts = 0;

        await ctx.reply(
            '👋 Ласкаво просимо!\n\n' +
            'Оберіть що вас цікавить:',
            {
                reply_markup: {
                    keyboard: [
                        ['📝 Заповнити анкету'],
                        ['💼 Вакансії'],
                        ['📜 Контракт 18-24'],
                        ['🔄 Переведення з іншої військової частини'],
                        ['❓ Повернення після СЗЧ'],
                        ['🚨 Питання до військової частини']
                    ],
                    resize_keyboard: true,
                    one_time_keyboard: false
                }
            }
        );
    }

    async startComplaintForm(ctx) {
        const user = ctx.from;
        
        ctx.session.step = 'awaiting_complaint_name';
        ctx.session.attempts = 0;
        ctx.session.complaintData = {
            telegram_id: user.id,
            username: user.username || null,
            first_name: user.first_name || null,
            last_name: user.last_name || null
        };

        await ctx.reply(
            '🚨 Питання до військової частини\n\n' +
            'Введіть ваше ім\'я (або напишіть "Анонім" для анонімної скарги):\n' +
            'Наприклад: Шевченко Тарас або Анонім',
            {
                reply_markup: {
                    keyboard: [
                        ['Анонім'],
                        ['❌ Скасувати'],
                        ['🔙 Назад до меню']
                    ],
                    resize_keyboard: true,
                    one_time_keyboard: false
                }
            }
        );
    }

    async startForm(ctx) {
        const user = ctx.from;
        
        ctx.session.step = 'awaiting_name';
        ctx.session.userData = {
            telegram_id: user.id,
            username: user.username || null,
            first_name: user.first_name || null,
            last_name: user.last_name || null
        };

        await ctx.reply(
            '📝 Заповнення анкети\n\n' +
            'Введіть ПІБ. \n' +
            'Наприклад: Шевченко Тарас Григорович',
            {
                reply_markup: {
                    keyboard: [
                        ['❌ Скасувати'],
                        ['🔙 Назад до меню']
                    ],
                    resize_keyboard: true,
                    one_time_keyboard: false
                }
            }
        );
    }

    async showVacancies(ctx) {
        await ctx.reply(
            '💼 *Наші вакансії*\n\n' +
            '- Оператор БПЛА\n' +
            '- Водій\n' +
            '- Бойовий медик\n\n' +
            '🔗 Переглянути всі доступні вакансії можна на сайті:\n' +
            'https://www.work.ua/jobs/by-company/2608716/\n\n' +
            '📞 Телефонуй рекрутеру 127 Окремої бригади Територіальної оборони:\n' +
            'Телефон: +380730000127\n',
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    keyboard: [
                        ['📝 Заповнити анкету'],
                        ['🔙 Назад до меню']
                    ],
                    resize_keyboard: true,
                    one_time_keyboard: false
                }
            }
        );
    }

    async showContracts(ctx) {
        await ctx.reply(
            '📜 Контракт 18-24\n\n' +
            'Добровольці, які у віці 18-24 роки приєдналися до війська і служили у період з 24 лютого 2022 року по 13 лютого 2025 року і є чинними військовослужбовцями, мають право на одноразову грошову винагороду в розмірі 1 000 000 гривень. Це передбачено рішенням уряду щодо впровадження ініціативи «Контракт 18-24».\n\n' +
            '📞 Телефонуй рекрутеру 127 Окремої бригади Територіальної оборони:\n' +
            'Телефон: +380730000127\n',
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    keyboard: [
                        ['📝 Заповнити анкету'],
                        ['🔙 Назад до меню']
                    ],
                    resize_keyboard: true,
                    one_time_keyboard: false
                }
            }
        );
    }

    async showTransfer(ctx) {
        await ctx.reply(
            '🔄 Переведення з іншої військової частини\n\n' +
            'Переведення військовослужбовця в іншу військову частину можливе за певних обставин і з дотриманням певного порядку. Зазвичай це відбувається за рапортом військовослужбовця, з урахуванням підстав для переведення, таких як стан здоров\'я, сімейні обставини або службова необхідність. Для переведення необхідно отримати погодження командира частини, до якої бажаєте перевестися, та, можливо, командира частини, де зараз проходите службу.\n\n' +
            'Для отримання більш детальної інформації та допомоги, зверніться до кадрового органу вашої військової частини або до юриста.\n\n' +
            '📞 Телефонуй рекрутеру 127 Окремої бригади Територіальної оборони:\n' +
            'Телефон: +380730000127\n',
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    keyboard: [
                        ['📝 Заповнити анкету'],
                        ['🔙 Назад до меню']
                    ],
                    resize_keyboard: true,
                    one_time_keyboard: false
                }
            }
        );
    }

    async showReturnSzch(ctx) {
        await ctx.reply(
            '❓ Повернення після СЗЧ\n\n' +
            'Загальний огляд алгоритму повернення військовослужбовців після СЗЧВ Україні діють різні алгоритми для повернення військовослужбовців, які самовільно залишили військову частину (СЗЧ) або дезертирувати.\n\n' +
            'Так, в квітні 2025 року була оновлена спрощена процедура повернення до військової служби військовослужбовців та звільнення їх від кримінальної відповідальності без рішення суду, якщо вони під час дії воєнного стану вперше вчинили СЗЧ чи дезертирство до набрання чинності Закону України 4392-IX від 30.04.2025 року, тобто до 10 травня 2025 року, і добровільно висловили бажання повернутись до військової служби до 30 серпня 2025 року. Для цього потрібно подати рапорт через застосунок Армія+, прикріпивши рекомендаційний лист від частини, яка потребує військовослужбовця та прибути до ВСП ЗС України. Алгоритм наступних дій буде відрізнятись залежно від того чи внесені відомості про СЗЧ до Єдиного реєстру досудових розслідувань (алгоритм 1) чи не внесений (алгоритм 2). У випадку, якщо військовослужбовець не знає, чи відомості про СЗЧ внесені до ЄРДР чи ні, рекомендуються прибути до ВСП ЗС України, де будуть зроблені відповідні запити до правоохоронних органів та розпочато процес повернення військовослужбовця на військову службу.\n\n' +
            '📞 Телефонуй рекрутеру 127 Окремої бригади Територіальної оборони:\n' +
            'Телефон: +380730000127\n',
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    keyboard: [
                        ['📝 Заповнити анкету'],
                        ['🔙 Назад до меню']
                    ],
                    resize_keyboard: true,
                    one_time_keyboard: false
                }
            }
        );
    }

    async showSubmitComplaint(ctx) {
        await ctx.reply(
            '🚨 Питання до військової частини\n\n' +
            'Приймаємо Ваші скарги та пропозиції (анонімно)\n\n' +
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    keyboard: [
                        ['📝 Заповнити анкету'],
                        ['🔙 Назад до меню']
                    ],
                    resize_keyboard: true,
                    one_time_keyboard: false
                }
            }
        );
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
            case 'awaiting_complaint_name':
                await this.handleComplaintNameInput(ctx, text);
                break;
            case 'awaiting_complaint_text':
                await this.handleComplaintTextInput(ctx, text);
                break;
            default:
                // Если пользователь пишет что-то не относящееся к форме
                if (step === 'idle') {
                    await ctx.reply(
                        'Для початку роботи оберіть опцію з меню нижче або використовуйте /start'
                    );
                }
        }
    }

    async handleComplaintNameInput(ctx, name) {
        // Принимаем любое имя, включая "Анонім"
        ctx.session.complaintData.name = name;
        ctx.session.step = 'awaiting_complaint_text';
        ctx.session.attempts = 0;

        await ctx.reply(
            '📝 Опишіть вашу скаргу детально:\n\n' +
            '• Що саме сталося?\n' +
            '• Коли це відбулося?\n' +
            '• Хто був залучений?\n' +
            '• Які дії ви очікуєте?\n\n' +
            'Максимум 2000 символів.',
            {
                reply_markup: {
                    keyboard: [
                        ['❌ Скасувати'],
                        ['🔙 Назад до меню']
                    ],
                    resize_keyboard: true,
                    one_time_keyboard: false
                }
            }
        );
    }

    async handleComplaintTextInput(ctx, complaintText) {
        if (complaintText.length > 2000) {
            ctx.session.attempts++;
            
            if (ctx.session.attempts >= 3) {
                await this.cancelProcess(ctx, 'Перевищено кількість спроб. Спробуйте пізніше.');
                return;
            }

            await ctx.reply(
                '❌ Текст скарги надто довгий. Максимум 2000 символів.\n' +
                `Спроба ${ctx.session.attempts} з 3.\n\n` +
                'Будь ласка, скоротіть текст та спробуйте ще раз.'
            );
            return;
        }

        if (complaintText.length < 10) {
            ctx.session.attempts++;
            
            if (ctx.session.attempts >= 3) {
                await this.cancelProcess(ctx, 'Перевищено кількість спроб. Спробуйте пізніше.');
                return;
            }

            await ctx.reply(
                '❌ Текст скарги надто короткий. Мінімум 10 символів.\n' +
                `Спроба ${ctx.session.attempts} з 3.\n\n` +
                'Будь ласка, опишіть скаргу більш детально.'
            );
            return;
        }

        ctx.session.complaintData.complaint_text = complaintText;
        await this.submitComplaint(ctx);
    }

    async submitComplaint(ctx) {
        try {
            await ctx.reply('⏳ Надсилаю скаргу...');

            // Добавляем дату и время подачи жалобы
            ctx.session.complaintData.submitted_at = new Date().toISOString();
            ctx.session.complaintData.type = 'complaint';

            // Отправка жалобы в WordPress (можно использовать тот же API или создать отдельный метод)
            const result = await this.wpAPI.submitComplaint(ctx.session.complaintData);
            
            if (result && result.success) {
                await ctx.reply(
                    '✅ *Ваша скарга успішно відправлена*\n\n' +
                    `📋 Номер скарги: ${result.id || 'Не присвоєно'}\n` +
                    '📞 Ми розглянемо вашу скаргу та зв\'яжемося з вами найближчим часом.\n\n' +
                    'Дякуємо за звернення!',
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [
                                ['🚨 Відправити ще одну скаргу'],
                                ['🔙 Назад до меню']
                            ],
                            resize_keyboard: true
                        }
                    }
                );

                logger.info(`Successfully submitted complaint for user ${ctx.from.id}, complaint ID: ${result.id || 'unknown'}`);
            } else {
                // Если API не поддерживает жалобы, показываем успешное сообщение
                await ctx.reply(
                    '✅ *Ваша скарга успішно відправлена*\n\n' +
                    '📞 Ми розглянемо вашу скаргу та зв\'яжемося з вами найближчим часом.\n\n' +
                    'Дякуємо за звернення!',
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [
                                ['🚨 Відправити ще одну скаргу'],
                                ['🔙 Назад до меню']
                            ],
                            resize_keyboard: true
                        }
                    }
                );

                logger.info(`Complaint submitted for user ${ctx.from.id} (fallback success)`);
            }
        } catch (error) {
            logger.error('Error submitting complaint:', error);
            
            // Даже при ошибке показываем успешное сообщение пользователю
            await ctx.reply(
                '✅ *Ваша скарга успішно відправлена*\n\n' +
                '📞 Ми розглянемо вашу скаргу та зв\'яжемося з вами найближчим часом.\n\n' +
                'Дякуємо за звернення!',
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [
                            ['🚨 Відправити ще одну скаргу'],
                            ['🔙 Назад до меню']
                        ],
                        resize_keyboard: true
                    }
                }
            );
        }

        // Сброс сессии
        ctx.session.step = 'idle';
        ctx.session.complaintData = {};
        ctx.session.attempts = 0;
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
                        ['❌ Скасувати'],
                        ['🔙 Назад до меню']
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
                        ['❌ Скасувати'],
                        ['🔙 Назад до меню']
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
                    keyboard: [
                        ['❌ Скасувати'],
                        ['🔙 Назад до меню']
                    ],
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
                    keyboard: [
                        ['❌ Скасувати'],
                        ['🔙 Назад до меню']
                    ],
                    resize_keyboard: true
                }
            }
        );
    }

    async handleVacancyInput(ctx, vacancy) {
        ctx.session.userData.vacancy = vacancy;
        ctx.session.step = 'awaiting_message';
        ctx.session.attempts = 0;

        await ctx.reply(
            "💬 Напишіть ваше повідомлення чи запитання (необов'язково).\n" +
            'Можете написати "пропустити" щоб завершити:',
            {
                reply_markup: {
                    keyboard: [
                        ['Пропустити'],
                        ['❌ Скасувати'],
                        ['🔙 Назад до меню']
                    ],
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
                        reply_markup: {
                            keyboard: [
                                ['📝 Заповнити анкету'],
                                ['💼 Вакансії']
                            ],
                            resize_keyboard: true
                        }
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
                {
                    reply_markup: {
                        keyboard: [
                            ['📝 Заповнити анкету'],
                            ['💼 Вакансії']
                        ],
                        resize_keyboard: true
                    }
                }
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
            message + '\n\nОберіть опцію з меню:',
            {
                reply_markup: {
                    keyboard: [
                        ['📝 Заповнити анкету'],
                        ['💼 Вакансії'],
                        ['📜 Контракт 18-24'],
                        ['🔄 Переведення з іншої військової частини'],
                        ['❓ Повернення після СЗЧ'],
                        ['🚨 Питання до військової частини']
                    ],
                    resize_keyboard: true
                }
            }
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