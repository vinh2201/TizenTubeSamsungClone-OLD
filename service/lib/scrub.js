'use strict';

// A log line that holds an address as YouTube writes it (/api/timedtext?v=...&ip=...&cpn=...) tells whoever reads
// the log which video was watched, from where, and which account was signed in. What is useful in a log is that
// the request happened and how it ended, so the values of a query string are dropped and its names are kept.
const QUERY_VALUE = /([?&;][A-Za-z0-9_.%-]{1,60})=([^&\s"'<>)\]]+)/g;

const scrub = (text) => String(text).replace(QUERY_VALUE, '$1=~');

module.exports = { scrub };
