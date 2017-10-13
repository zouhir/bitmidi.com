'use strict'

module.exports = createStore

const copy = require('clipboard-copy')
const debug = require('debug')('nodefoo:store')
const debugVerbose = require('debug')('nodefoo:store:verbose')

const api = require('./api')
const config = require('../config')
const Location = require('./lib/location')
const routes = require('./routes')

const DEBUG_VERBOSE = new Set([
  'APP_RESIZE'
])

function createStore (render, onFetchDone) {
  const store = {
    location: {
      name: null,
      params: {},
      pathname: null
    },
    app: {
      title: null,
      width: 0,
      height: 0,
      fetchCount: 0
    },
    userName: null,
    doc: null,
    errors: [],

    snippets: {}, // snippet.id -> snippet
    topSnippetIds: null
  }

  const loc = new Location(routes, location => {
    dispatch('LOCATION_CHANGED', location)
  })

  function dispatch (type, data) {
    if (DEBUG_VERBOSE.has(type)) debugVerbose('%s %o', type, data)
    else debug('%s %o', type, data)

    switch (type) {
      /**
       * LOCATION
       */

      case 'LOCATION_PUSH': {
        const pathname = data
        if (pathname !== store.location.pathname) loc.push(pathname)
        return
      }

      case 'LOCATION_REPLACE': {
        const pathname = data
        if (pathname !== store.location.pathname) loc.replace(pathname)
        return
      }

      case 'LOCATION_CHANGED': {
        Object.assign(store.location, data)
        if (config.isBrowser) window.ga('send', 'pageview', data.pathname)
        return update()
      }

      /**
       * APP
       */

      case 'APP_TITLE': {
        const title = data ? data + ' – ' + config.name : config.name
        store.app.title = title
        return update()
      }

      case 'APP_RESIZE': {
        store.app.width = data.width
        store.app.height = data.height
        return update()
      }

      /**
       * DOC
       */

      case 'API_DOC': {
        fetchStart()
        api.doc.get(data, (err, doc) => {
          dispatch('API_DOC_DONE', { err, doc })
        })
        return update()
      }

      case 'API_DOC_DONE': {
        fetchDone()
        const { err, doc } = data
        if (err) return addError(err)
        store.doc = doc
        return update()
      }

      /**
       * SNIPPET
       */

      // TODO: rename 'fetch' prefix to something better. 'async'?
      case 'API_SNIPPET_ADD': {
        fetchStart()
        if (store.userName == null) {
          addPendingDispatch(type, data)
          addError(
            new Error('Last step! Log in to get credit for your contribution.')
          )
          window.location.href = '/auth/twitter'
          return
        }
        api.snippet.add(data, (err, result) => {
          dispatch('API_SNIPPET_ADD_DONE', { err, result })
        })
        return update()
      }

      case 'API_SNIPPET_ADD_DONE': {
        fetchDone()
        const { err } = data
        if (err) return addError(err)
        dispatch('LOCATION_PUSH', '/')
        return update()
      }

      case 'API_SNIPPET_VOTE': {
        fetchStart()
        if (store.userName == null) {
          addPendingDispatch(type, data)
          addError(new Error('Log in with Twitter to vote!'))
          window.location.href = '/auth/twitter'
          return
        }
        api.snippet.vote(data, (err, snippet) => {
          dispatch('API_SNIPPET_VOTE_DONE', { err, snippet })
        })
        return update()
      }

      case 'API_SNIPPET_VOTE_DONE': {
        fetchDone()
        const { err, snippet } = data
        if (err) return addError(err)
        addSnippet(snippet)
        return update()
      }

      case 'API_SNIPPET_GET': {
        fetchStart()
        api.snippet.get(data, (err, snippet) => {
          dispatch('API_SNIPPET_GET_DONE', { err, snippet })
        })
        return update()
      }

      case 'API_SNIPPET_GET_DONE': {
        fetchDone()
        const { err, snippet } = data
        if (err) return addError(err)

        addSnippet(snippet)
        return update()
      }

      case 'API_SNIPPET_ALL': {
        fetchStart()
        api.snippet.all(data, (err, snippets) => {
          dispatch('API_SNIPPET_ALL_DONE', { err, snippets })
        })
        return update()
      }

      case 'API_SNIPPET_ALL_DONE': {
        fetchDone()
        const { err, snippets } = data
        if (err) return addError(err)

        snippets.map(addSnippet)
        store.topSnippetIds = snippets.map(snippet => snippet.id)
        return update()
      }

      /**
       * SEARCH
       */

      case 'SEARCH_INPUT': {
        store.lastSearch = data
        return update()
      }

      /**
       * CLIPBOARD
       */

      case 'CLIPBOARD_COPY': {
        copy(data)
        return
      }

      /**
       * PENDING DISPATCH
       */

      case 'RUN_PENDING_DISPATCH': {
        if (window.localStorage.pendingDispatch == null) return

        let event
        try {
          event = JSON.parse(window.localStorage.pendingDispatch)
        } catch (err) {}

        delete window.localStorage.pendingDispatch

        dispatch(event.type, event.data)
        return update()
      }

      default: {
        throw new Error(`Unrecognized dispatch type "${type}"`)
      }
    }
  }

  function addPendingDispatch (type, data) {
    window.localStorage.pendingDispatch = JSON.stringify({ type, data })
  }

  // Reference counter for pending fetches
  function fetchStart () {
    store.app.fetchCount += 1
  }

  function fetchDone () {
    store.app.fetchCount -= 1
    if (typeof onFetchDone === 'function') onFetchDone()
  }

  function addError (err) {
    store.errors.push({ message: err.message, code: err.code })
    if (config.isBrowser) window.alert(err.message)
    update()
  }

  function addSnippet (snippet) {
    store.snippets[snippet.id] = snippet
  }

  let isRendering = false
  let isUpdatePending = false

  function update () {
    // Prevent infinite recursion when dispatch() is called during an update()
    if (isRendering) {
      isUpdatePending = true
      return
    }
    debugVerbose('update')

    isRendering = true
    render()
    isRendering = false

    if (isUpdatePending) {
      isUpdatePending = false
      update()
    }
  }

  return {
    store,
    dispatch
  }
}
