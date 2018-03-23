const restify = require('restify');
const builder = require('botbuilder');
const botbuilder_azure = require("botbuilder-azure");
const axios = require('axios');
const unirest = require('unirest');

const nconf = require('nconf');
nconf.argv()
.env()
.file({ file: 'config.json' });

var knownAdresses = [];
function _addKnownAddressAndRule(address, regExpString) {
    // Just to check ...
    //
    new RegExp(regExpString);

    const knownAddress = {address: address, rule: regExpString};
    knownAdresses.push(knownAddress);

    const addressesString = JSON.stringify(knownAdresses);
    nconf.set('knownAddress', addressesString);

    nconf.save();
}
(function _initKnownAddresses() {
    const addressesString = nconf.get('knownAddress');
    if (addressesString !== '' && addressesString !== null && addressesString != undefined) {
        knownAdresses = JSON.parse(addressesString);
    }
    nconf.set('knownAddress', addressesString);
})();

// Setup Restify Server
//
const server = restify.createServer();
const port = nconf.any('port', 'PORT');
server.name = "localhost";
server.listen(port || 3978, function () {
 console.log('%s listening to %s', server.name, server.url);
});

const botName = nconf.any('clientname', 'clientName', 'botname', 'botName');
const spacesExpr = "[ ]*";
const botNameExpr = `([@]?${botName})?${spacesExpr}`;
const serviceInfExpr = `${spacesExpr}(<[^>]*>)*`;

// Create chat connector for communicating with the Bot Framework Service
//
const appId = nconf.any('MicrosoftAppId', 'AppId', 'appId');
const appPassword = nconf.any('MicrosoftAppPassword', 'AppPassword', 'appPassword');
const botOpenIdMetadata = nconf.any('BotOpenIdMetadata', 'botOpenIdMetadata');
console.log('MicrosoftAppId: %s', appId);
console.log('MicrosoftAppPassword: %s', appPassword);
console.log('openIdMetadata: %s', botOpenIdMetadata);
const connector = new builder.ChatConnector({
    appId: appId,
    appPassword: appPassword,
    openIdMetadata: botOpenIdMetadata
});

// Listen for messages from users 
server.post('/api/messages', connector.listen());

const bot = new builder.UniversalBot(connector);

// Register in-memory storage
//
const inMemoryStorage = new builder.MemoryBotStorage();
bot.set('storage', inMemoryStorage); 

// ------------------------------------------------
// Dialogs

bot.dialog('/', [
	function (session) {
        const msg = `You said: "${session.message.text}". Sorry, but i didn't understand ... Please type help for instructions.`;
        session.endConversation(msg);
    }
    ]);

bot.dialog('setup', [
  function (session) {
    session.send("Setup begin !");
    builder.Prompts.text(session, 'Please enter an expression for filtering the required tasks');
},
function (session, results) {
    try {
      const regExpString = results.response;
      console.log("got regex: ", regExpString);

      const address = session.message.address;
      console.log("address: ", address);

      _addKnownAddressAndRule(address, regExpString);

      session.send("Setup completed !");
  } catch (error) {
    session.send("Setup failed ! "+error);
}
}])
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

// ------------------------------------------------
// Jenkins client

const QUEUED='QUEUED';
const RUNNING='RUNNING';
const SUCCESS='SUCCESS';
const FAULT='FAULT';

const jenkinsClient = require('./jenkinsClient.js');
const connection = new jenkinsClient.Connection();

(function test() {
    connection.test();
    connection.getBuilds().subscribe(console.log);
})();
// connection.open(buildInfo => {

//     if (buildInfo.result == QUEUED) {
//         text = `Задача ${buildInfo.fullDisplayName} была поставлена в очередь.`;
//     } else if (buildInfo.result == RUNNING) {
//         text = `Задача ${buildInfo.fullDisplayName} выполняется.`;
//     } else if (buildInfo.result == SUCCESS) {
//         text = `Задача ${buildInfo.fullDisplayName} завершена успешно.`;
//     } else if (buildInfo.result == FAULT) {
//         text = `Задача ${buildInfo.fullDisplayName} завершена с ошибками.`;
//     } else {
//         return;
//     }

//     const buildInfoCards = getBuildInfoCard(text, buildInfo);
//     console.log(JSON.stringify(buildInfoCards))
//     knownAdresses.forEach(knownAddress => {
//         const address = knownAddress.address;
//         const rule = knownAddress.rule;
//         if (buildInfo.fullDisplayName.match(new RegExp(rule))) {
//             say(address, text, buildInfoCards);
//         }
//     });
// });

// function getBuildInfoCard(text, buildInfo) {

//     items = [{
//         "type": "TextBlock",
//         "text": text,
//         "weight": "bolder",
//         "size": "medium"
//     }];
//     if (hasChanges(buildInfo)) {
//         items.push(getChanges(buildInfo));
//     }
//     const cards = [
//     {
//         'contentType': 'application/vnd.microsoft.card.adaptive',
//         'content': {
//             "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
//             "type": "AdaptiveCard",
//             "version": "1.0",
//             "body": items,
//             "actions": [{
//                 "type": "Action.OpenUrl",
//                 "url": `${buildInfo.url}/consoleText`,
//                 "title": "Show log"
//             }]
//         }
//     }];

//     return cards;
// }

function hasChanges(buildInfo) {
    return (buildInfo.changeSet !== null && buildInfo.changeSet !== undefined);
}
function getChanges(buildInfo) {
    if (buildInfo.changeSet) {
        return {
            "type": "FactSet",
            "facts": buildInfo.changeSet.items.map(item => [
                {title: 'commit', value: item.commitId.substring(0, 6)},
                {title: 'author', value: item.author.fullName},
                {title: 'message', value: item.msg},
                ])
        };
    }
    return undefined;
}

function say (address, text, cards) {
    let message = new builder.Message()
    .address(address)
    if (cards !== undefined && cards !== null) {
        cards.forEach(card => {
            message.addAttachment(card);
        });
    } else {
        message.text(text);
    }

    bot.send(message);
}