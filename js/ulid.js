/**
 * ulid.js - ULID (Universally Unique Lexicographically Sortable Identifier) Generator
 * Crockford's Base32, 26 characters (48-bit timestamp + 80-bit randomness)
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ULID = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const ENCODING_LEN = ENCODING.length;
  const TIME_LEN = 10;
  const RANDOM_LEN = 16;

  function encodeTime(now, len) {
    let str = '';
    let time = now;
    for (let i = len - 1; i >= 0; i--) {
      const mod = time % ENCODING_LEN;
      str = ENCODING.charAt(mod) + str;
      time = (time - mod) / ENCODING_LEN;
    }
    return str;
  }

  function getRandomValues(buf) {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      return crypto.getRandomValues(buf);
    }
    try {
      const nodeCrypto = require('crypto');
      const bytes = nodeCrypto.randomBytes(buf.length);
      for (let i = 0; i < buf.length; i++) {
        buf[i] = bytes[i];
      }
      return buf;
    } catch (e) {
      for (let i = 0; i < buf.length; i++) {
        buf[i] = Math.floor(Math.random() * 256);
      }
      return buf;
    }
  }

  function encodeRandom(len) {
    const buf = new Uint8Array(len);
    getRandomValues(buf);
    let str = '';
    for (let i = 0; i < len; i++) {
      str += ENCODING.charAt(buf[i] % ENCODING_LEN);
    }
    return str;
  }

  function generate(seedTime) {
    const time = typeof seedTime === 'number' ? seedTime : Date.now();
    return encodeTime(time, TIME_LEN) + encodeRandom(RANDOM_LEN);
  }

  function isValid(id) {
    if (typeof id !== 'string' || id.length !== 26) return false;
    const regex = /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{26}$/;
    return regex.test(id.toUpperCase());
  }

  return {
    generate,
    isValid,
    ENCODING
  };
}));
