const Observable = require("rxjs/Observable").Observable;
const Subject = require("rxjs/Subject").Subject;

const of = require('rxjs/observable/of').of;
const merge = require('rxjs/observable/merge').merge;
const fromPromise = require('rxjs/observable/fromPromise').fromPromise;
const mapTo = require('rxjs/operators').mapTo;
const map = require('rxjs/operators').map;
const delay = require('rxjs/operators').delay;
const take = require('rxjs/operators').take;
const throttle = require('rxjs/operators').throttle;
const groupBy = require('rxjs/operators').groupBy;
const mergeMap = require('rxjs/operators').mergeMap;
const catchError = require('rxjs/operators').catchError;
const interval = require('rxjs/observable/interval').interval;
const debounceTime = require('rxjs/operators/debounceTime').debounceTime;

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
        const defaultUsername = 'root';
        return (username || defaultUsername);
    }
    getPassword() {
        const password = nconf.get('password');
        const defaultPassword = '123';
        return (password || defaultPassword);
    }
    getJenkinsCrumb() {
        const crumb = nconf.get('crumb');
        const defaultCrumb = 'a061bce7dbded1cdc4a3bd443ee2ed42';
        return (crumb || defaultCrumb);
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

        // out stream
        //
        this.builds = new Subject();
    }

    test() {
        const empty = of(null);
        this.builds = merge(
            empty.pipe(
                mapTo({url: '/job/test-build/34/', result: QUEUED}),
                delay(200)
            ),
            empty.pipe(
                mapTo({url: '/job/test-build/34/', result: RUNNING}),
                delay(1000)
            ),
            empty.pipe(
                mapTo({url: '/job/test-build/34/', result: SUCCESS}),
                delay(2000)
            ),
            empty.pipe(
                mapTo({url: '/job/test-build/35/', result: QUEUED}),
                delay(100)
            ),
            empty.pipe(
                mapTo({url: '/job/test-build/35/', result: RUNNING}),
                delay(150)
            ),
            empty.pipe(
                mapTo({url: '/job/test-build/35/', result: FAULT}),
                delay(200)
            )
        );
    }

    getBuilds() {
        const groupedById = this.builds.pipe(
            groupBy( e => e.url )
        );
        const clearedQuickStages = groupedById.pipe( 
            mergeMap( group => group.pipe( debounceTime(1000) ) ),
            mergeMap( e => fromPromise(this._getBuildInfo(e)) )
        );
        return clearedQuickStages;
    }

    _getBuildInfo(e) {
        return new Promise((resolve, reject) => {
            const buildInfoUrl = `${this.settings.getJenkinsUrl()}/${e.url}api/json`;
            unirest.post(buildInfoUrl)
            .auth({
                user: this.settings.getUsername(),
                pass: this.settings.getPassword(),
                sendImmediately: true
            })
            .headers({
                'Cookie': this.cookies,
                'crumb': this.settings.getJenkinsCrumb()
            })
            .type('json')
            .end((response, error) => {
                if (response) {
                    if (response.code === 200) {
                        resolve(response.body);
                    } else {
                        reject(response.raw_body);
                    }
                } else if (error) {
                    reject(error);
                } else {
                    reject('no response');
                }
            })
        });
    }

    _getNextBatchID() {
        return this.configurationBatchId++;
    }

    open() {
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
                this.builds.next(payload.jenkins_object_url);
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
        .headers({
            'Cookie': this.cookies,
            '.crumb': this.settings.getJenkinsCrumb()
        })
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
  Connection: Connection,
  QUEUED: QUEUED,
  RUNNING: RUNNING,
  SUCCESS: SUCCESS,
  FAULT: FAULT
};