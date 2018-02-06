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
connection.open(payload => {
    const name = payload.job_name;
    const number = payload.jenkins_object_id;
    const status = payload.job_run_status;
    const url = payload.jenkins_object_url;
    let text = undefined;
    let actions = [
        {
            "type": "Action.OpenUrl",
            "url": `${url}`,
            "title": "Open"
        }
    ];
    if (status==QUEUED) {
        text = `Задача ${name} была поставлена в очередь.`;
    } else if (status==RUNNING) {
        text = `Задача ${name} #${number} выполняется.`;
    } else if (status==SUCCESS) {
        text = `Задача ${name} #${number} завершена успешно.`;
    } else if (status==FAULT) {
        text = `Задача ${name} #${number} завершена с ошибками.`;
        actions.push(
            {
                "type": "Action.OpenUrl",
                "url": `${url}/consoleText`,
                "title": "Show log"
            }
        );
    } else {
        return;
    }
    console.log(text);

    // For example ...
    const cards = [
    {
        'contentType': 'application/vnd.microsoft.card.adaptive',
        'content': {
            "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
            "type": "AdaptiveCard",
            "version": "1.0",
            "body": [
            {
                "type": "Container",
                "items": [
                {
                    "type": "TextBlock",
                    "text": text,
                    "weight": "bolder",
                    "size": "large"
                },
                {
                    "type": "TextBlock",
                    "text": text,
                    "weight": "bolder",
                    "size": "medium"
                },
                {
                    "type": "TextBlock",
                    "text": text,
                    "weight": "bolder",
                },
                {
                    "type": "TextBlock",
                    "text": text,
                    "weight": "bolder",
                    "size": "small"
                }
                ]
            }
            ],
            "actions": actions
        }
    }
    ];

    knownAdresses.forEach(knownAddress => {
        const address = knownAddress.address;
        const rule = knownAddress.rule;
        if (name.match(new RegExp(rule))) {
            say(address, text/*, cards*/);
        }
    });
});

function say (address, text, cards) {
    let message = new builder.Message()
                             .address(address)
                             .text(text);
    if (cards !== undefined && cards !== null) {
        cards.forEach(card => {
            message.addAttachment(card);
        });
    }

   bot.send(message);
}