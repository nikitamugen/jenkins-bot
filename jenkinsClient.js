const assert = require('assert');
const unirest = require('unirest');
const EventSource = require("eventsource");

const nconf = require('nconf');
nconf.argv().env().file({ file: 'config.json' });

const QUEUED='QUEUED';
const RUNNING='RUNNING';
const SUCCESS='SUCCESS';
const FAULT='FAULT';

class Settings {
    constructor() {}

    getJenkinsUrl() {
        const jenkinsUrl = nconf.any('jenkinsUrl', 'jenkinsRoot', 'jenkinsRootUrl');
        const defaultUrl = 'http://127.0.0.1:8080';
        return (jenkinsUrl || defaultUrl);
    }
    getClientName() {
        return nconf.any('clientName');
    }
    getClientId() {
        const clientName = this.getClientName();
        const randomId = this._getRandomId();
        const clientId = `${clientName}_id:${randomId}`;
        return encodeURIComponent(clientId);
    }
    _getRandomId() {
        return Math.random().toString(36).substring(7);
    }
    getUsername() {
        const username = nconf.any('username', 'userName');
        return username;
    }
    getPassword() {
        const username = nconf.get('password');
        return username;
    }
}

class Connection {
    constructor() {
        this.settings = new Settings();
        this.jsessionid = undefined;
        this.cookies = undefined;
        this.eventSource = undefined;
        this.sessionInfo = undefined;
        this.configurationBatchId = 0;
    }

    _getNextBatchID() {
        return this.configurationBatchId++;
    }

    open(onEvent) {
        assert.notEqual(onEvent, null);
        this.onEvent = onEvent;

        this._connectInternal();
    }

    _connectInternal() {
        console.log(`Connect to Jenkins`);
        const connectUrl = `${this.settings.getJenkinsUrl()}/sse-gateway/connect?clientId=${this.settings.getClientId()}`;
        unirest.get(connectUrl)
        .auth({
            user: this.settings.getUsername(),
            pass: this.settings.getPassword(),
            sendImmediately: true
        })
        .end(response => {
            console.log(response)
            this.jsessionid = response.body.data.jsessionid;
            this.cookies = this._cookieObjectToString(response.cookies);

            console.log(`Add listeners`);
            const listenMethod = `${this.settings.getJenkinsUrl()}/sse-gateway/listen/${this.settings.getClientId()};jsessionid=${this.jsessionid}`;
            this.eventSource = new EventSource(listenMethod);
            this.eventSource.addEventListener('open', (e) => {
                console.log('SSE channel "open" event.', e);
                if (e.data) {
                    this.sessionInfo = JSON.parse(e.data);
                    this._configureInternal();
                }
            }, false);
            this.eventSource.addEventListener('job', e => {
                const payload = JSON.parse(e.data);
                this.onEvent(payload);
            }, false);
        });
    }

    _configureInternal() {
        console.log(`Configure channels`);
        const job = {
            jenkins_channel: 'job'
        };
        const configuration = {
            subscribe: [job],
            dispatcherId: this.sessionInfo.dispatcherId
        };

        const configureUrl = `${this.settings.getJenkinsUrl()}/sse-gateway/configure?batchId=${this._getNextBatchID()}`;
        unirest.post(configureUrl)
        .auth({
            user: this.settings.getUsername(),
            pass: this.settings.getPassword(),
            sendImmediately: true
        })
        .headers({'Cookie': this.cookies})
        .type('json')
        .send(configuration)
        .end(function (response) {
            console.log('ok');
        });
    }

    _cookieObjectToString(cookie) {
        const exp = /jsessionid./i;
        for (let prop in cookie) {
            if (prop.match(exp))
                return `${prop}=${cookie[prop]}`;
        }
    }
}

module.exports = {
  Connection: Connection
};