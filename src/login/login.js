import * as crypto from '../crypto/crypto.js'
import {fixUsername} from '../io/loginStore.js'
import {base16, base58, base64, utf8} from '../util/encoding.js'
import * as server from './server.js'

/**
 * Converts a login reply from the server into the local storage format.
 */
function makeLoginData (username, loginReply, dataKey) {
  const out = {
    username: fixUsername(username)
  }

  // Copy common items:
  const keys = [
    'passwordAuthBox', 'passwordBox', 'passwordKeySnrp',
    'rootKeyBox', 'syncKeyBox', 'repos'
  ]
  keys.forEach(key => {
    if (key in loginReply) {
      out[key] = loginReply[key]
    }
  })

  // Store the pin key unencrypted:
  if ('pin2KeyBox' in loginReply) {
    const pin2Key = crypto.decrypt(loginReply.pin2KeyBox, dataKey)
    out.pin2Key = base58.stringify(pin2Key)
  }

  // Store the recovery key unencrypted:
  if ('recovery2KeyBox' in loginReply) {
    const recovery2Key = crypto.decrypt(loginReply.recovery2KeyBox, dataKey)
    out.recovery2Key = base58.stringify(recovery2Key)
  }

  return out
}

/**
 * Access to the logged-in user data.
 *
 * This type has following powers:
 * - Access to the auth server
 * - A list of account repos
 * - The legacy BitID rootKey
 */
export function Login (io, userId, dataKey, loginData) {
  if (userId.length !== 32) {
    throw new Error('userId must be a hash')
  }

  // Identity:
  this.username = loginData.username
  this.userId = userId
  this.dataKey = dataKey

  // Return access to the server:
  if (!loginData.passwordAuthBox) {
    throw new Error('Missing passwordAuthBox')
  }
  this.passwordAuth = crypto.decrypt(loginData.passwordAuthBox, dataKey)

  // Legacy account repo:
  if (loginData.syncKeyBox) {
    this.syncKey = crypto.decrypt(loginData.syncKeyBox, dataKey)
  }

  // Legacy BitID key:
  if (loginData.rootKeyBox) {
    this.rootKey = crypto.decrypt(loginData.rootKeyBox, dataKey)
  }

  // TODO: Decrypt these:
  this.repos = loginData.repos || []

  // Local keys:
  if (loginData.pin2Key) {
    this.pin2Key = base58.parse(loginData.pin2Key)
  }
  if (loginData.recovery2Key) {
    this.recovery2Key = base58.parse(loginData.recovery2Key)
  }
}

/**
 * Returns a new login object, populated with data from the server.
 */
Login.online = function (io, username, userId, dataKey, loginReply) {
  const loginData = makeLoginData(username, loginReply, dataKey)
  io.loginStore.update(userId, loginData)

  return new Login(io, userId, dataKey, loginData)
}

/**
 * Returns a new login object, populated with data from the local storage.
 */
Login.offline = function (io, username, userId, dataKey) {
  const loginData = io.loginStore.find({username})
  const out = new Login(io, userId, dataKey, loginData)

  // Try updating our locally-stored login data (failure is ok):
  io
    .authRequest('POST', '/v2/login', out.authJson())
    .then(loginReply => {
      const loginData = makeLoginData(username, loginReply, dataKey)
      return io.loginStore.update(userId, loginData)
    })
    .catch(e => io.log.error(e))

  return out
}

/**
 * Sets up a login v2 server authorization JSON.
 */
Login.prototype.authJson = function () {
  return {
    'userId': base64.stringify(this.userId),
    'passwordAuth': base64.stringify(this.passwordAuth)
  }
}

/**
 * Searches for the given account type in the provided login object.
 * Returns the repo keys in the JSON bundle format.
 */
Login.prototype.accountFind = function (type) {
  // Search the repos array:
  for (const repo of this.repos) {
    if (repo['type'] === type) {
      const keysBox = repo['keysBox'] || repo['info']
      return JSON.parse(utf8.stringify(crypto.decrypt(keysBox, this.dataKey)))
    }
  }

  // Handle the legacy Airbitz repo:
  if (type === 'account:repo:co.airbitz.wallet') {
    return {
      'syncKey': base16.stringify(this.syncKey),
      'dataKey': base16.stringify(this.dataKey)
    }
  }

  throw new Error(`Cannot find a "${type}" repo`)
}

/**
 * Creates and attaches new account repo.
 */
Login.prototype.accountCreate = function (io, type) {
  return server.repoCreate(io, this, {}).then(keysJson => {
    return this.accountAttach(io, type, keysJson).then(() => {
      return server.repoActivate(io, this, keysJson)
    })
  })
}

/**
 * Attaches an account repo to the login.
 */
Login.prototype.accountAttach = function (io, type, info) {
  const infoBlob = utf8.parse(JSON.stringify(info))
  const data = {
    'type': type,
    'info': crypto.encrypt(io, infoBlob, this.dataKey)
  }

  const request = this.authJson()
  request['data'] = data
  return io.authRequest('POST', '/v2/login/repos', request).then(reply => {
    this.repos.push(data)
    io.loginStore.update(this.userId, {repos: this.repos})
    return null
  })
}
