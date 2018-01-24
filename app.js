/*-----------------------------------------------------------------------------
A simple echo bot for the Microsoft Bot Framework. 
-----------------------------------------------------------------------------*/

const __API__ = 'https://random-chooser-backend.herokuapp.com/api/v1';

const restify = require('restify');
const builder = require('botbuilder');
const botbuilder_azure = require("botbuilder-azure");
const EventSource = require("eventsource");
const axios = require('axios');

// Setup Restify Server
//
const server = restify.createServer();
server.listen(process.env.port || process.env.PORT || 3978, function () {
   console.log('%s listening to %s', server.name, server.url); 
});

const botName = "random-chooser-bot";

const spacesExpr = "[ ]*";
const botNameExpr = `([@]?${botName})?${spacesExpr}`;

const serviceInfExpr = `${spacesExpr}(<[^>]*>)*`;

// Create chat connector for communicating with the Bot Framework Service
//
const connector = new builder.ChatConnector({
    appId: process.env.MicrosoftAppId,
    appPassword: process.env.MicrosoftAppPassword,
    openIdMetadata: process.env.BotOpenIdMetadata
});

// Listen for messages from users 
server.post('/api/messages', connector.listen());

const bot = new builder.UniversalBot(connector);

// Register in-memory storage
//
const inMemoryStorage = new builder.MemoryBotStorage();
bot.set('storage', inMemoryStorage); 

// Register table storage
//
// const tableName = 'botdata';
// const azureTableClient = new botbuilder_azure.AzureTableClient(tableName, process.env['AzureWebJobsStorage']);
// const tableStorage = new botbuilder_azure.AzureBotStorage({ gzipData: false }, azureTableClient);
// bot.set('storage', tableStorage);

bot.dialog('/', [
	function (session) {
		const msg = `You said: "${session.message.text}". Sorry, but i didn't understand ... Please type help for instructions.`;
		session.endConversation(msg);
	}
])

bot.dialog('setup', [
	function (session) {
		session.send("Setup begin !");
		getVariantListArray()
		.then(variantListArray => {
			let choiceCounter = 0;
			let choices = variantListArray.map(variantList => {
				const choice = {
					value: variantList.name,
					text: variantList.name
				};
				return choice;
			});
			builder.Prompts.choice(session, 'Please choose variant list', choices, {
	            maxRetries: 5,
	            retryPrompt: 'Ooops, you just choosed incorrect variant. Please try again ...'
			});
		})
		.catch(error => {
			console.log(error);
			const address = session.message.address;
			say(address, error);
		})
	},
	function (session, results) {
		try {
			const variantListName = results.response.entity;
			const address = session.message.address;
			addSSEListener(variantListName, address);

			const card = createCustomCard(session, "Setup comlete !",'','',variantListName);
			say(address, '', card);
		} catch (error) {
			const address = session.message.address;
			say(address, error);
		} finally {
			session.endConversation();
		}
	}
])
.endConversationAction(
    "endSetup", "Setup canceled !",
    {
    	matches: new RegExp(`^${botNameExpr}(cancel|goodbye)${serviceInfExpr}$`, 'i'),
        confirmPrompt: "This will cancel your order. Are you sure?"
    }
)
.triggerAction({
    matches: new RegExp(`^${botNameExpr}setup${serviceInfExpr}$`, 'i'),
    onSelectAction: (session, args, next) => {
        // Add the help dialog to the dialog stack 
        // (override the default behavior of replacing the stack)
        //
        session.beginDialog(args.action, args);
    }
});

bot.dialog('help', function (session) {
	try {
		const address = session.message.address;
		sayHelp(address);
	} catch (error) {
		const address = session.message.address;
		say(address, error);
	} finally {
		session.endConversation();
	}
})
.triggerAction({
    matches: new RegExp(`^${botNameExpr}help${serviceInfExpr}$`, 'i'),
    onSelectAction: (session, args, next) => {
        // Add the help dialog to the dialog stack 
        // (override the default behavior of replacing the stack)
        //
        session.beginDialog(args.action, args);
    }
});

bot.dialog('next', function (session) {
	try {
		session.send("Wait a second. Post *next* operation on the server ...");

		const address = session.message.address;
		postListOperationByAddress(address, "next");
	}
	catch (error) {
		say(address, "error");
	}
	finally {
		session.endConversation();
	}
})
.triggerAction({
    matches: new RegExp(`^${botNameExpr}next${serviceInfExpr}$`, 'i'),
    onSelectAction: (session, args, next) => {
        // Add the help dialog to the dialog stack 
        // (override the default behavior of replacing the stack)
        //
        session.beginDialog(args.action, args);
    }
});

bot.dialog('random', function (session) {
	try {
		session.send("Wait a second. Post *random* operation on the server ...");

		const address = session.message.address;
		postListOperationByAddress(address, "randomNext");
	}
	catch (error) {
		say(address, "error");
	}
	finally {
		session.endConversation();
	}
})
.triggerAction({
    matches: new RegExp(`^${botNameExpr}random${serviceInfExpr}$`, 'i'),
    onSelectAction: (session, args, next) => {
        // Add the help dialog to the dialog stack 
        // (override the default behavior of replacing the stack)
        //
        session.beginDialog(args.action, args);
    }
});

function postListOperationByAddress (address, operation) {
	try {
		const variantListName = _getListByAddress(address);
		const encodedVariantListName = encodeURIComponent(variantListName);

		const webMethod = `${__API__}/variantList/${operation}/${encodedVariantListName}`;
		return axios.post(webMethod)
		.catch(error => {
			say(address, error);
		});
	}
	catch (error) {
		say(address, "Sorry, but i don't know list to make operation under. Please make *setup* for begin.");
	}
}

function getVariantListArray () {
	const webMethod = `${__API__}/variantList/`;
	return axios.get(webMethod)
	.then((response) => {
		return response.data;
	})
}

function addSSEListener (variantListName, address) {
	if (isEmpty(variantListName)) {
		console.log("addSSEListener|variantListName is Empty");
		return;
	}
	if (isEmpty(address)) {
		console.log("addSSEListener|address is Empty");
		return;
	}
	_removeListEmiterByList(variantListName);
	_addListEmiterByList(variantListName, address);
}
function _removeListEmiterByList (variantListName) {
	if (knownListEmiterDict.hasOwnProperty(variantListName)) {
		eventSource = knownListEmiterDict[variantListName]
		eventSource.close();

		delete knownListEmiterDict[variantListName];
	}
	if (knownListAdressDict.hasOwnProperty(variantListName)) {
		delete knownListAdressDict[variantListName];
	}
}
function _removeListEmiterByAddress (address) {
	const variantListName = _getListByAddress(address);
	_removeListEmiterByList(variantListName);
}
function _addListEmiterByList (variantListName, address) {
	const encodedVariantListName = encodeURIComponent(variantListName);
	const encodedConversion = encodeURIComponent(address.conversation.id);
	const webMethod = `${__API__}/events/${encodedVariantListName}/${encodedConversion}`;
	console.log(`Register event listener at ${webMethod}`);
	eventSource = new EventSource(webMethod, {withCredentials: true});
	eventSource.onerror = sseEventErrorHandler;
	eventSource.onmessage = sseEventHandler;

	knownListEmiterDict[variantListName] = eventSource;
	knownListAdressDict[variantListName] = address;
}

function sseEventHandler (event) {
	try {
		const message = JSON.parse(event.data);
		const variantListName = message.listName;
		const address = getAdressByList(variantListName);

		if (message.type == "CONNECTED") {
			console.log(`CONNECTED with list: "${variantListName}"`);
		} else if (message.type == "VARIANT_LIST_REMOVE") {
			say(address, `Sorry, but variant list with name: "${variantListName}" was removed. Type *setup* to continue. Or remove me.`);
			eventSource.close();
		} else {
			sayEventMessage(address, message);
		}
	} catch (error) {
		console.log(`Got error in "sseEventHandler" method. ${error}`);
	}
}
function sseEventErrorHandler (event) {
	if (eventSource.readyState === 2) {
		console.log(`Listener fault". Try reconnect after 5 seconds`);
		setTimeout(addSSEListener, 5000);
	}
}

var knownListAdressDict = {};
var knownListEmiterDict = {};
function getAdressByList (variantListName) {
	if (knownListAdressDict.hasOwnProperty(variantListName)) {
		return knownListAdressDict[variantListName];
	}
	throw `List "${variantListName}" is unknown !`;
}
function _getListByAddress (address) {
	console.log(`address|channelId:${address.channelId}; isGroup:${address.conversation.isGroup}; conversation.id:${address.conversation.id}; conversation.name:${address.conversation.name}`);
	for (variantListName in knownListAdressDict) {
		const listAddress = knownListAdressDict[variantListName];
		if (listAddress.conversation.id === address.conversation.id) {
			return variantListName;
		}
	}
	throw `Address "${address}" is not registered !`;
}
function getEmiterByList (variantListName) {
	if (knownListEmiterDict.hasOwnProperty(variantListName)) {
		return knownListEmiterDict[variantListName];
	}
	throw `List "${variantListName}" is unknown !`;
}

const botAddedAction = "add";
const botRemovedAction = "remove";
bot.on('contactRelationUpdate', (event) => {
	const address = event.address;
	if (event.action === botAddedAction) {
		const msg = "Oh ... Hi there ! For begin type *help* for instructions. Or say *setup* to setup :)";
		say(address, msg);
	} else if (event.action === botRemovedAction) {
		const msg = "Goodbye ! :)";
		say(address, msg);

		_removeListEmiterByAddress(address);
	}	
});

function say (address, text, card) {
	let message = new builder.Message()
	 			   .address(address)
	 			   .text(text);
	if (!isEmpty(card)) {
		message.addAttachment(card);
	}

	bot.send(message);
}
function sayEventMessage (address, eventMessage) {
	bot.loadSession(address, (error, session) => {
		if (!isEmpty(error)) {
			throw error;
		} else {
			const card = createEventMessageCard(session, eventMessage);
			say(address, '', card);
		}
	});
}
function createEventMessageCard(session, eventMessage) {
	const card = new builder.HeroCard(session)
	.subtitle("Got message")
    .text(eventMessage.text)
    .buttons([
    	(function createGotoListButton(session, eventMessage) {
	    	const variantListName = eventMessage.listName;
	    	const listUrl = createListUrl(variantListName);
	    	const msg = `Current list: "${variantListName}"`;
	    	return builder.CardAction.openUrl(session, listUrl, msg);
	    })(session, eventMessage)
    ]);

    return card;
}
function sayHelp(address) {
	let variantListName = "";
	try {
		variantListName = _getListByAddress(address);
	} catch (error) {}
	bot.loadSession(address, (error, session) => {
		if (!isEmpty(error)) {
			throw error;
		} else {
			const card = createHelpCard(session, variantListName);
			say(address, '', card);
		}
	});
}
function createHelpCard(session, variantListName) {
	const card = new builder.ReceiptCard(session)
    .title('Available commands:')
    .facts([
        builder.Fact.create(session, '( setup )', 'Setup listener for variant list'),
        builder.Fact.create(session, '( next )', 'Choose next variant'),
        builder.Fact.create(session, '( random )', 'Choose random variant'),
        builder.Fact.create(session, '( help )', 'This menu')
    ]);
    if (!isEmpty(variantListName)) {
    	const listUrl = createListUrl(variantListName);
    	const msg = `Current list: "${variantListName}"`;
    	card.buttons([
			builder.CardAction.openUrl(session, listUrl, msg)
		]);
    }

    return card;
}
function createCustomCard(session, title, subtitle, text, variantListName) {
	const card = new builder.HeroCard(session)
    .title(title)
    .subtitle(subtitle)
    .text(text);
    if (!isEmpty(variantListName)) {
    	const listUrl = createListUrl(variantListName);
    	const msg = `Current list: "${variantListName}"`;
    	card.buttons([
			builder.CardAction.openUrl(session, listUrl, msg)
		]);
    }

    return card;
}
function createListUrl(variantListName) {
	const listUrl = `https://nikitamugen.gitlab.io/randomChooser`;
	return listUrl;
}

function isEmpty (some) {
	return (some === "" || some === undefined || some === null);
}