import dotenv from 'dotenv'
import TelegramBot from 'node-telegram-bot-api';
import fetch from 'node-fetch';
import { parse } from 'node-html-parser';
import validator from 'validator';
import schedule from 'node-schedule'
import fs from 'fs';

dotenv.config();

if (!fs.existsSync('database.json')) fs.writeFileSync('database.json', JSON.stringify({}, null, 2));
if (!fs.existsSync('watchlist.json')) fs.writeFileSync('watchlist.json', JSON.stringify({}, null, 2));

let database = JSON.parse(fs.readFileSync('database.json'));
let watchlist = JSON.parse(fs.readFileSync('watchlist.json'));

const currencies = {
    'AUD': 'A$',
    'BRL': 'R$',
    'CAD': 'CA$',
    'CNY': 'CNY',
    'CZK': 'Kč',
    'DKK': 'kr',
    'EUR': '€',
    'HKD': 'HK$',
    'HUF': 'Ft',
    'ILS': '₪',
    'JPY': '¥',
    'MYR': 'RM',
    'MXN': 'MX$',
    'TWD': 'NT$',
    'NZD': 'NZ$',
    'NOK': 'kr',
    'PHP': '₱',
    'PLN': 'zł',
    'GBP': '£',
    'RUB': '₽',
    'SGD': 'S$',
    'SEK': 'kr',
    'CHF': 'CHF',
    'THB': '฿',
    'USD': '$',
}

console.log("Logging in...");

const bot = new TelegramBot(process.env.TOKEN, { polling: true });

console.log("Started!")

// For testing only!
await getDailyDeal();

const job = schedule.scheduleJob('0 21 * * *', async function () {
    await getDailyDeal();
});

bot.onText(/\/start/, async (msg) => addChannel(msg));
bot.onText(/\/add/, async (msg) => addToWatchlist(msg));
bot.onText(/\/remove/, async (msg) => removeFromWatchList(msg));
bot.onText(/\/watchlist/, async (msg) => getUserWatchlist(msg));
bot.onText(/\/currency/, async (msg) => changeChannelCurrency(msg));
bot.onText(/\/list/, async (msg) => getUserWatchlist(msg));
bot.onText(/\/delete/, async (msg) => removeChannel(msg));
bot.onText(/\/help/, async (msg) => sendHelpText(msg));

async function addChannel(msg) {

    console.log(msg)

    await getDatabase();

    if (!database[msg.chat.id]) database[msg.chat.id] = ['USD', 'EUR'];
    bot.sendMessage(msg.chat.id, `
<b>Welcome!</b>

This bot will send you a ${(getChatType(msg) === 'DM' ? getChatType(msg) : 'message in your ' + getChatType(msg))} every time the Libidex Daily Deal is updated. Add things you're looking to buy using <code>/add &lt;Libidex Item URL&gt;</code> and get a special ping when that item is the Daily Deal!

<i>For example...</i>
<code>/add https://libidex.com/neo-catsuit-no-pouch.html</code> adds the <a href="https://libidex.com/neo-catsuit-no-pouch.html">Neo Catsuit (no pouch)</a> to your watchlist.

You can also change what the currencies for the auto price conversion. Most ISO 4217 currencies are supported. Use <code>/currency &lt;ISO 4217 Codes&gt;</code> to change currencies.

<i>For example...</i>
<code>/currency USD EUR CAD</code> will convert the Libidex price to US Dollars, Euros, and Canadian Dollars at the current exchange rate.
${(getChatType(msg) === "DM") ? "\nThis bot also works very well in groups! Invite this bot so that all you friends and fellow rubberists can get alerted of the new Daily Deal!\n" : ""}
/help for all commands.

<i>Bot created by <a href="https://t.me/pup_bodhi">Pup_Bodhi</a>. Open source on <a href="https://github.com/pup-bodhi/libidex-daily-deals-bot">GitHub!</a></i>
                `, { parse_mode: 'HTML', disable_web_page_preview: true });

    await setDatabase();

}

async function addToWatchlist(msg) {

    if (!await checkDatabase(msg.chat.id)) return;

    await getWatchlist();

    let msgText = msg.text.replace('/add ', '');
    msg.text.replace('/add ', '');

    if (!validator.isURL(msgText) || !msgText.includes('libidex.com')) return bot.sendMessage(msg.chat.id, `
<i>Argument is not a valid Libidex URL!</i>\n
<b>Usage:</b> <code>/add &lt;Libidex Item URL&gt;</code>
        `, { reply_to_message_id: msg.message_id, parse_mode: 'HTML' })

    try {
        const itemPage = await (await fetch(msgText)).text();
        const itemParse = parse(itemPage);
        const productId = Number(itemParse.querySelector('.price-final_price').getAttribute('data-product-id'));
        const name = itemParse.querySelector('.product-info-main').querySelector('span[itemprop="name"]').innerHTML;

        if (!watchlist[productId]) watchlist[productId] = { id: productId, name: name, url: msgText, users: [] };
        if (!watchlist[productId].users.some(user => user.username === msg.from.username)) watchlist[productId].users.push({ id: msg.from.id, username: msg.from.username })

        await setWatchlist();

        bot.sendMessage(msg.chat.id, `
        <a href="${msgText}"><b>${name}</b> (#${productId})</a><i> added to your personal watchlist! You will get a ping when your item is the daily deal.</i>
        `, { reply_to_message_id: msg.message_id, parse_mode: 'HTML', disable_web_page_preview: true });
    } catch (e) {
        console.error(e)
        bot.sendMessage(msg.chat.id, `
            Could not parse Libidex item. Are you sure you have a valid Libidex URL?
            `, { reply_to_message_id: msg.message_id, parse_mode: 'HTML', disable_web_page_preview: true });

    }

}

async function removeFromWatchList(msg) {

    if (!await checkDatabase(msg.chat.id)) return;

    await getWatchlist();

    let msgText = msg.text.replace('/remove ', '');
    msg.text.replace('/remove ', '');

    if (!validator.isURL(msgText) || !msgText.includes('libidex.com')) return bot.sendMessage(msg.chat.id, `
        <i>Argument is not a valid Libidex URL!</i>\n
<b>Usage:</b> <code>/remove &lt;Libidex Item URL&gt;</code>
        `, { reply_to_message_id: msg.message_id, parse_mode: 'HTML' })

    try {

        const itemPage = await (await fetch(msgText)).text();
        const itemParse = parse(itemPage);
        const productId = Number(itemParse.querySelector('.price-final_price').getAttribute('data-product-id'));
        const name = itemParse.querySelector('.product-info-main').querySelector('span[itemprop="name"]').innerHTML;

        if (watchlist[productId].users.length <= 1)
            delete watchlist[productId]
        else watchlist[productId].users.splice(watchlist[productId].users.indexOf(msg.from.username), 1)

        await setWatchlist();

        bot.sendMessage(msg.chat.id, `
        <a href="${msgText}"><b>${name}</b> (#${productId})</a><i> removed from your personal watchlist.</i>
        `, { reply_to_message_id: msg.message_id, parse_mode: 'HTML', disable_web_page_preview: true });
    } catch {
        bot.sendMessage(msg.chat.id, `
            Could not parse Libidex item. Are you sure you have a valid Libidex URL?
            `, { reply_to_message_id: msg.message_id, parse_mode: 'HTML', disable_web_page_preview: true });

    }
}

async function getUserWatchlist(msg) {

    if (!await checkDatabase(msg.chat.id)) return;

    await getWatchlist();

    let userList = '';

    if (Object.keys(watchlist).length <= 0) return bot.sendMessage(msg.chat.id, `<i>You have no items on your watchlist.</i>`, { reply_to_message_id: msg.message_id, parse_mode: 'HTML', disable_web_page_preview: true });

    Object.keys(watchlist).forEach(item => {
        if (watchlist[item].users.some(users => users.username === msg.from.username)) userList += `\n- <a href="${watchlist[item].url}">${watchlist[item].name} (#${watchlist[item].id})</a>`
    })

    if (userList === '') return bot.sendMessage(msg.chat.id, `<i>You have no items on your watchlist.</i>`, { reply_to_message_id: msg.message_id, parse_mode: 'HTML', disable_web_page_preview: true });
    bot.sendMessage(msg.chat.id, `<i>Items on your watchlist:</i>\n${userList}`, { reply_to_message_id: msg.message_id, parse_mode: 'HTML', disable_web_page_preview: true });
}

async function removeChannel(msg) {

    await getDatabase();

    delete database[msg.chat.id];
    bot.sendMessage(msg.chat.id, `
<b>Unsubscribed from Daily Deal alerts.</b>
You will no longer recieve alerts when new Daily Deals have been posted. Use /start to resubscribe.

Thank you for using me!

<i>Bot created by <a href="https://t.me/pup_bodhi">Pup_Bodhi</a></i>
                `, { parse_mode: 'HTML', disable_web_page_preview: true });

    await setDatabase();
}

async function sendHelpText(msg) {
    bot.sendMessage(msg.chat.id, `
    <b>Libidex Deals Bot</b>
<i>A bot to fetch and alert Telegram groups of new items in Libidex's Daily Deal.</i>\n
<b>Commands:</b>
- <code>/start</code>: Subscribes your DM/group to Daily Deal alerts.
- <code>/currency &lt;ISO 4217 Codes&gt;</code>: Changes auto price conversion currency. Use ISO 4217 codes, e.g. USD, EUR, CAD etc...
- <code>/watchlist</code>: View your personal item watchlist.
- <code>/add &lt;Libidex Item URL&gt;</code>: Add an item to your watchlist. Get pinged when an item on your list becomes the Daily Deal!
- <code>/remove &lt;Libidex Item URL&gt;</code>: Removes and item from your watchlist.
- <code>/delete</code>: Unsubscribes your DM/group from Daily Deal alerts.
- <code>/help</code>: Get help with commands. If you need even more help.\n
Bot created by <a href="https://pupbodhi.com">Pup_Bodhi</a>
            `, { reply_to_message_id: msg.message_id, parse_mode: 'HTML', disable_web_page_preview: true });

}

async function changeChannelCurrency(msg) {

    if (!await checkDatabase(msg.chat.id)) return;

    let msgText = msg.text.replace('/currency ', '');

    let currencyArray = msgText.split(' ');

    if (currencyArray.length <= 0 || msgText === '/currency') { 
        database[msg.chat.id] = [];
        await setDatabase();
        return bot.sendMessage(msg.chat.id, `
<i>Removed all currency conversions.</i>
                            `, { reply_to_message_id: msg.message_id, parse_mode: 'HTML' })
    }


    currencyArray.forEach(currency => {
        if (!currencies[currency]) return bot.sendMessage(msg.chat.id, `
<i>Argument is not a valid ISO 4217 currency!</i>\n
<b>Usage:</b> <code>/currency &lt;ISO 4217 Codes&gt;</code>
To add multiple currencies, seperate each currency code with a space. Ex: <code>/currency USD EUR</code>
            `, { reply_to_message_id: msg.message_id, parse_mode: 'HTML' })
    })
    database[msg.chat.id] = currencyArray;
    await setDatabase();
    bot.sendMessage(msg.chat.id, `
<i>New currencies set!</i>
                    `, { reply_to_message_id: msg.message_id, parse_mode: 'HTML' })
}


async function getDailyDeal() {
    return new Promise(async (resolve, reject) => {

        await getDatabase();
        await getWatchlist();

        try {
            const today = new Date();
            const libidexPage = await (await fetch('https://libidex.com')).text();
            const libidexParse = parse(libidexPage);
            const banner = libidexParse.querySelector(`.promtion-banner`)

            const itemLink = banner.querySelector('a');
            const itemPage = await (await fetch(itemLink.getAttribute('href'))).text();
            const itemParse = parse(itemPage);

            const name = itemParse.querySelector('.page-title span').innerHTML;
            const originalPrice = Number(itemParse.querySelector('.old-price .price').innerHTML.replace(/[^0-9\.-]+/g, ""));
            const newPrice = Number(itemParse.querySelector('.special-price .price').innerHTML.replace(/[^0-9\.-]+/g, ""));
            const productId = Number(itemParse.querySelector('.price-final_price').getAttribute('data-product-id'));

            const exchangeRateInfo = await (await fetch('https://open.er-api.com/v6/latest/GBP')).json();

            if (database.length <= 0) return resolve();

            Object.keys(database).forEach(group => {
                let conversionText = '';
                database[group].forEach(currency => {
                    conversionText += `\n${currency.toUpperCase()}  <s>${currencies[currency.toUpperCase()]}${(originalPrice * exchangeRateInfo.rates[currency.toUpperCase()]).toFixed(2)}</s>  ->  ${currencies[currency.toUpperCase()]}${(newPrice * exchangeRateInfo.rates[currency.toUpperCase()]).toFixed(2)}`
                })
                let text = `
<i>A new Libidex Daily Deal item has been posted!</i>

<b><a href="${itemLink.getAttribute('href')}">${name} (#${productId})</a></b>
GBP  <s>£${originalPrice}</s>  ->  £${newPrice}${conversionText}

<i>Bot created by <a href="https://t.me/pup_bodhi">Pup_Bodhi</a>. Open source on <a href="https://github.com/pup-bodhi/libidex-daily-deals-bot">GitHub!</a></i>
`
                try { bot.sendMessage(group, text, { parse_mode: 'HTML' }); } catch { };
            })

            console.log(`\nSucsessfully parsed Libidex deals on ${today.getUTCMonth() + 1}/${today.getUTCDate()}/${today.getUTCFullYear()}!`)

            if (!watchlist[productId]) return resolve()

            setTimeout(() => {
                Object.keys(database).forEach(channel => {
                    let watchlistText = `<b>This item is on someone's watchlist!</b>\n\n`;
                    watchlist[productId].users.forEach(user => {
                        let member = bot.getChatMember(channel, user.id);
                        if (member) watchlistText += `@${user.username}\n`;
                    })
                    if (watchlistText !== `<b>This item is on someone's watchlist!</b>\n\n`)
                        bot.sendMessage(channel, watchlistText, { parse_mode: 'HTML' });
                })
    
                console.log('Alerted watchlist users!')
            }, 2000)

            resolve();

        } catch (e) {
            console.error('Error fetching Libidex deals.');
            console.error(e);
            await bot.sendMessage(telegramChannel, `Help @Pup_Bodhi! I'm broken!\n\n<code>${e.name}: ${e.message}</code>\n\n<i>Please view the console logs for more details.</i>`, { parse_mode: 'HTML' });

            resolve();
        }
    })
}

function getChatType(msg) {
    switch (msg.chat.type) {
        case 'private': return 'DM'; break;
        case 'group': return 'group'; break;
        case 'channel': return 'channel'; break;
    }
}

async function checkDatabase(chatId) {
    return new Promise(async (resolve, reject) => {

        await getDatabase();

        if (Object.keys(database).find(x => x = chatId)) return resolve(true)
        else bot.sendMessage(chatId, `
            Not subscribed to Daily Deal alerts! Please use /start first.
            `, { parse_mode: 'HTML', disable_web_page_preview: true });

        resolve(false);
    })
}

async function getDatabase() {
    return new Promise((resolve, reject) => {
        database = JSON.parse(fs.readFileSync('database.json'));
        resolve();
    })
}

async function getWatchlist() {
    return new Promise((resolve, reject) => {
        watchlist = JSON.parse(fs.readFileSync('watchlist.json'));
        resolve();
    })
}

async function setDatabase() {
    return new Promise((resolve, reject) => {
        fs.writeFileSync('database.json', JSON.stringify(database, null, 2));
        resolve();
    })
}

async function setWatchlist() {
    return new Promise((resolve, reject) => {
        fs.writeFileSync('watchlist.json', JSON.stringify(watchlist, null, 2));
        resolve();
    })
}