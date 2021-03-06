/**
 * Wraps `LocalStorage` with a namespace and other extra goodies.
 */
export function ScopedStorage (localStorage, prefix) {
  this.localStorage = localStorage
  this.prefix = prefix + '.'
}

ScopedStorage.prototype.getItem = function (key) {
  return this.localStorage.getItem(this.prefix + key)
}

ScopedStorage.prototype.setItem = function (key, value) {
  return this.localStorage.setItem(this.prefix + key, value)
}

ScopedStorage.prototype.removeItem = function (key) {
  return this.localStorage.removeItem(this.prefix + key)
}

ScopedStorage.prototype.getJson = function (key) {
  const text = this.getItem(key)
  return text == null ? null : JSON.parse(text)
}

ScopedStorage.prototype.setJson = function (key, value) {
  return this.setItem(key, JSON.stringify(value))
}

ScopedStorage.prototype.subStore = function (prefix) {
  return new ScopedStorage(this.localStorage, this.prefix + prefix)
}

ScopedStorage.prototype.keys = function () {
  const keys = []
  const search = new RegExp('^' + this.prefix)
  for (let i = 0; i < this.localStorage.length; ++i) {
    const key = this.localStorage.key(i)
    if (search.test(key)) {
      keys.push(key.replace(search, ''))
    }
  }
  return keys
}

ScopedStorage.prototype.removeAll = function () {
  this.keys().forEach(key => {
    this.removeItem(key)
  })
}

ScopedStorage.prototype.setItems = function (items) {
  Object.keys(items).forEach(key => {
    const item = items[key]
    if (typeof item === 'string') {
      this.setItem(key, item)
    } else {
      this.setJson(key, item)
    }
  })
}
