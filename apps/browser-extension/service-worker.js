// Quant Scholar unified extension worker.
// Imported modules keep separate lexical scopes while sharing Chrome APIs.
import * as fullVideo from './full-video.mjs';
globalThis.QSFullVideo = fullVideo;
import './background.js';
import './research/background.js';
import './learning/settings.js';
import './learning/background.js';
