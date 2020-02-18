[![Build Status](https://travis-ci.org/lucid-services/serviser.svg?branch=master)](https://travis-ci.org/lucid-services/serviser)  [![Test Coverage](https://codeclimate.com/github/lucid-services/serviser/badges/coverage.svg)](https://codeclimate.com/github/lucid-services/serviser/coverage) [![npm version](https://badge.fury.io/js/serviser.svg)](https://www.npmjs.com/package/serviser)  

[![Serviser Logo](https://github.com/lucid-services/serviser/raw/master/logo.png)](https://lucid-services.github.io/serviser)


`serviser` is abstraction layer built on top of [express](https://github.com/expressjs/express) for creating transparent, scalable and stable `REST API`s.  

The emphasis is put, among other  [features](https://github.com/lucid-services/serviser#features), on REST API documentation, validation (security), error handling and automation of perpetually repeasted tasks.

Quick start
------------------

```bash
> mkdir my-api
> cd my-api 
> npx serviser-template init # shorthand for npm i serviser-template
                             # && ./node_modules/.bin/serviser-template init
> npm start
```

Resources
-------------------
* [Getting started](https://lucid-services.github.io/serviser/tutorial-1.Getting-started.html)
* [Public API Reference](https://lucid-services.github.io/serviser/)
* [Changelog](./CHANGELOG.md)


Features
-------------------
* **Promises!**
* **Documentation autogeneration**
* **A SDK client package autogeneration**
* [JSON Schema](http://json-schema.org/) integration (no duplicate definitions anymore!)
* request data validation
* response data filters
* App lifecycle events (event driven)
* shell integration
* Resource & Service integrity inspection capabilities (health monitoring)
* caching solutions
* Semantic Service versioning
* and more (see Public API Reference)!


What this project is NOT:
---------------------------
- All in one MVC & ORM robust and opinionated solution.  

Main ideas:  
Interfaces are created and procedures standardized only where it's necessary.  
Non-integral parts of the framework are built as plugins.  
Loosely coupled design is often prefered.

Tests
-------------------

`npm test`

