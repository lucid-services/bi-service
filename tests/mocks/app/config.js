module.exports = {
    apps: {
        app1: {
            baseUrl: 'http://127.0.0.1',
            listen: 5903,
            bodyParser: {$ref: '#/bodyParser'}
        },
        app2: {
            baseUrl: 'http://127.0.0.1',
            listen: 5904,
            bodyParser: {$ref: '#/bodyParser'}
        }

    },
    bodyParser: {
        json: {
            extended: true,
            type: 'application/json',
            limit: "2mb"
        }
    },
}

