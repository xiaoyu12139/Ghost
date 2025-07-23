const sentry = require('./shared/sentry');
const express = require('./shared/express');
const config = require('./shared/config');
const logging = require('@tryghost/logging');
const urlService = require('./server/services/url');

const fs = require('fs');
const path = require('path');

const isMaintenanceModeEnabled = (req) => {
    if (req.app.get('maintenance') || config.get('maintenance').enabled || !urlService.hasFinished()) {
        return true;
    }

    return false;
};

// We never want middleware functions to be anonymous
const maintenanceMiddleware = function maintenanceMiddleware(req, res, next) {
    if (!isMaintenanceModeEnabled(req)) {
        return next();
    }

    res.set({
        'Cache-Control': 'no-cache, private, no-store, must-revalidate, max-stale=0, post-check=0, pre-check=0'
    });
    res.writeHead(503, {'content-type': 'text/html'});
    fs.createReadStream(path.resolve(__dirname, './server/views/maintenance.html')).pipe(res);
};

// Used by Ghost (Pro) to ensure that requests cannot be served by the wrong site
const siteIdMiddleware = function siteIdMiddleware(req, res, next) {
    const configSiteId = config.get('hostSettings:siteId');
    const headerSiteId = req.headers['x-site-id'];

    if (`${configSiteId}` === `${headerSiteId}`) {
        return next();
    }

    logging.warn(`Mismatched site id (expected ${configSiteId}, got ${headerSiteId})`);

    res.set({
        'Cache-Control': 'no-cache, private, no-store, must-revalidate, max-stale=0, post-check=0, pre-check=0'
    });
    res.writeHead(500);
    res.end();
};

const rootApp = () => {
    const app = express('root');

    app.get('/ghost/api/v3/admin/default-tag', (req, res) => {
        // 读取文件或返回你想要的数据
        res.json({id: '000000008292eb1a4db37ea9', name: 'Default Tag'});
    });

    app.get('/ghost/api/v3/admin/custom-ghost-config', (req, res) => {
        const key = req.query.key;
        // 读取当前用户主目录下的 custom-ghost-config.json
        const os = require('os');
        const fs = require('fs');
        const path = require('path');
        const userHomeDir = os.homedir();
        const filePath = path.join(userHomeDir, 'custom-ghost-config.json');
        let config = {};
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({
                error: `Custom Config file not found: ${filePath}`
            });
        }
        try {
            const fileContent = fs.readFileSync(filePath, 'utf8');
            config = JSON.parse(fileContent);
        } catch (e) {
            return res.status(500).json({error: 'Config file invalid'});
        }
        if (key && config[key] !== undefined) {
            res.json({value: config[key]});
        } else {
            res.status(400).json({error: 'Invalid key'});
        }
    });

    app.use(sentry.requestHandler);
    if (config.get('sentry')?.tracing?.enabled === true) {
        app.use(sentry.tracingHandler);
    }
    if (config.get('hostSettings:siteId')) {
        app.use(siteIdMiddleware);
    }
    app.enable('maintenance');
    app.use(maintenanceMiddleware);

    return app;
};

module.exports = rootApp;
