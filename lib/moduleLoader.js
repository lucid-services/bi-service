const fs    = require("fs");
const _     = require("lodash");
const path  = require("path");
const debug = require('debug')('moduleLoader');

exports.loadModules  = loadModules;
exports.fileIterator = fileIterator;

/**
 * @module ModuleLoader
 * @class
 * @public
 */

/**
 * recursive wrapper around native `module.require`
 *
 * @function loadModules
 * @memberof ModuleLoader
 * @static
 * @example
 * require('serviser').moduleLoader.loadModules
 *
 * @param {Array|String} paths - collection of files/dirrectories, or single string path
 * @param {Object}   [options]
 * @param {Function} [options.cb] - the fn is provided with each required module
 * @param {Array}    [options.except] - collection of files/directories that should be excluded
 */
function loadModules(paths, options) {
    options = options || {};
    var load = function(file, dir) {
        return require(path.join(dir, file));
    };

    if (options.cb instanceof Function) {
        load = function(file, dir) {
            return options.cb(require(path.join(dir, file)));
        };
    }

    return fileIterator(paths, options, function(file, dir) {
        if (require.extensions[path.extname(file)]) {
            debug('Loading: ', dir + '/' + file);
            try {
                return load(file, dir);
            } catch(e) {
                debug('FAILED to load: ', dir + '/' + file, e.message);
                throw e;
            }
        }
    });
}

/**
 * synchronous helper function
 *
 * @function fileIterator
 * @memberof ModuleLoader
 * @static
 * @example
 * require('serviser').moduleLoader.fileIterator
 *
 * @param {Array|String} paths - file as well as directory paths
 * @param {Object} [options]
 * @param {Array} [options.except] - collection of files/directories that should be excluded
 * @param {Function} callback is provided with file (string), dirPath (string) arguments
 *
 * @return {undefined}
 */
function fileIterator(paths, options, callback) {
    var filePacks = [];
    if (typeof options === 'function') {
        callback = options;
        options = {};
    }

    if (typeof paths === 'string') {
        paths = [paths];
    } else if (paths instanceof Array) {
        paths = [].concat(paths);
    } else {
        throw new Error('Invalid first argument `paths`. Expected type of string or array');
    }

    options = options || {};
    var except = [];

    //normalize paths
    (options.except || []).forEach(function(p) {
        except.push(path.resolve(p));
    });

    paths.forEach(function(p, index) {
        if (fs.lstatSync(p).isDirectory()) {
            filePacks.push(fs.readdirSync(p));
        } else {
            //explicit file paths are already complete,
            filePacks.push([path.basename(p)]);
            paths.splice(index, 1, path.dirname(p));
        }
    });

    filePacks.forEach(function(files, index) {
        files.forEach(function(file) {
            var pth = path.join(paths[index], file);
            var isDir = fs.lstatSync(pth).isDirectory();

            //skip paths defined in options.except array
            if (except.indexOf(pth) !== -1) {
                return;
            }

            if (isDir) {
                fileIterator([pth], options, callback);
            } else {
                callback(file, paths[index]);
            }
        });
    });
}
