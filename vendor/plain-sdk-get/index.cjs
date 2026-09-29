// ponytail: only the Plain SDK's dot-separated paths; remove when its lodash.get dependency is removed.
module.exports = (object, path) => path.split('.').reduce((value, key) => value?.[key], object);
