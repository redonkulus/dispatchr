/**
 * Copyright 2014, Yahoo! Inc.
 * Copyrights licensed under the New BSD License. See the accompanying LICENSE file for terms.
 */
'use strict';

var Promise = global.Promise || require('bluebird'),
    debug = require('debug')('Highlander:dispatcher');

/**
 * @class Dispatcher
 * @param {Object} context The context to be used for store instances
 * @constructor
 */
function Dispatcher (context) {
    this.context = context || {};
    this.storeInstances = {};
    this.currentAction = null;
    this.actionQueue = [];
}

Dispatcher.stores = {};
Dispatcher.handlers = {};

/**
 * Registers a store so that it can handle actions.
 * @method registerStore
 * @static
 * @param {Object} store A store class to be registered. The store should have a static
 *      `name` property so that it can be loaded later.
 */
Dispatcher.registerStore = function (store) {
    if (Dispatcher.stores[store.name]) {
        throw new Error('Store `' + store.name + '` is already registerd.');
    }
    Dispatcher.stores[store.name] = store;
    if (store.handlers) {
        Object.keys(store.handlers).forEach(function (action) {
            var handler = store.handlers[action];
            Dispatcher.registerHandler(action, store.name, handler);
        });
    }
    return Dispatcher.stores[store.name];
};

/**
 * Adds a handler function to be called for the given action
 * @method registerHandler
 * @private
 * @static
 * @param {String} action Name of the action
 * @param {String} name Name of the store that handles the action
 * @param {String} handler Name of the function that handles the action
 * @returns {number}
 */
Dispatcher.registerHandler = function (action, name, handler) {
    Dispatcher.handlers[action] = this.handlers[action] || [];
    Dispatcher.handlers[action].push({
        name: name,
        handler: handler
    });
    return Dispatcher.handlers.length - 1;
};

/**
 * Returns a single store instance and creates one if it doesn't already exist
 * @method getStoreInstance
 * @param {String} name The name of the instance
 * @param {Object} initialState Initial state of the store used for rehydration
 * @returns {Object} The store instance
 */
Dispatcher.prototype.getStoreInstance = function (name, initialState) {
    if (!this.storeInstances[name]) {
        var Store = Dispatcher.stores[name];
        if (!Store) {
            throw new Error('Store ' + name + ' was not registered.');
        }
        this.storeInstances[name] = new (Dispatcher.stores[name])(this.context, initialState);
        if (this.storeInstances[name].setDispatcher) {
            this.storeInstances[name].setDispatcher(this);
        }
    }
    return this.storeInstances[name];
};

/**
 * Dispatches a new action or queues it up if one is already in progress
 * @method dispatch
 * @param {String} name Name of the action to be dispatched
 * @param {Object} payload Parameters to describe the action
 * @param {Function} callback Function to be called upon completion of
 *      the action.
 */
Dispatcher.prototype.dispatch = function (name, payload, callback) {
    if (!Dispatcher.handlers[name]) {
        return;
    }

    this.actionQueue.push({
        name: name,
        payload: payload,
        callback: callback,
        promise: null
    });
    debug('action ' + name + ' added to queue');
    return this.next();
};

/**
 * Handles the next Action in the queue if another Action is not in progress
 * @method next
 * @private
 * @returns {Object}
 */
Dispatcher.prototype.next = function () {
    if (this.currentAction) {
        return this.currentAction;
    }

    var self = this,
        nextAction = self.actionQueue.shift();

    if (nextAction) {
        self.currentAction = nextAction;

        var name = nextAction.name,
            payload = nextAction.payload,
            callback = nextAction.callback;

        self.currentAction.promise = self.handleAction(name, payload);
        self.currentAction.promise.nodeify(function (err, result) {
            debug('finished ' + name);
            self.currentAction = null;
            if (callback) {
                callback(err, result);
            }
            setImmediate(self.next.bind(self));
        });
    }

    return self.currentAction;
};

/**
 * Calls the handler functions for all stores that have registered for
 * the given event.
 * @method handleAction
 * @private
 * @param {String} name Name of the action to be handled
 * @param {Object} payload Parameters to describe the action
 * @returns {Promise}
 */
Dispatcher.prototype.handleAction = function (name, payload) {
    var self = this,
        handlerPromises = [];
    debug('handling ' + name);
    Dispatcher.handlers[name].forEach(function (store) {
        handlerPromises.push(new Promise(function(resolve, reject) {
            var storeInstance = self.getStoreInstance(store.name),
                finalHandler = function () {
                    resolve();
                    storeInstance.removeListener('error', errorHandler);
                },
                errorHandler = function (e) {
                    reject(e);
                    storeInstance.removeListener('final', finalHandler);
                };

            storeInstance.once('final', finalHandler);
            storeInstance.once('error', errorHandler);

            setImmediate(function () {
                storeInstance[store.handler](payload);
            });
        }));
    });
    return Promise.all(handlerPromises);
};

Dispatcher.prototype.toJSON = function () {
    var self = this,
        stores = {};
    Object.keys(self.storeInstances).forEach(function (storeName) {
        var store = self.storeInstances[storeName];
        if (store.toJSON) {
            stores[storeName] = store.toJSON();
        } else {
            stores[storeName] = store.getState();
        }
    });
    return {
        context: self.context,
        stores: stores
    };
};

Dispatcher.prototype.rehydrate = function (dispatcherState) {
    var self = this;
    self.context = dispatcherState.context;
    Object.keys(dispatcherState.stores).forEach(function (storeName) {
        var state = dispatcherState.stores[storeName];
        self.getStoreInstance(storeName, state);
    });
};

module.exports = Dispatcher;