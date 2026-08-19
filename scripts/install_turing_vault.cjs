"use strict";

const fs = require('fs');

const obsidian_vault_path = 'daylio_turing_test_vault/.obsidian/plugins/daylio-mood-graph/';
const build_path = 'build/';
const build_files = [
    'main.js',
    'main.js.map',
];

const static_files = [
    'manifest.json',
    'styles.css',
];

if (!fs.existsSync(obsidian_vault_path)) {
    fs.mkdirSync(obsidian_vault_path, { recursive: true });
}

build_files.forEach(f => {
    if (fs.existsSync(build_path + f)) {
        fs.copyFileSync(build_path + f, obsidian_vault_path + f);
    }
});

static_files.forEach(f => {
    if (fs.existsSync(f)) {
        fs.copyFileSync(f, obsidian_vault_path + f);
    }
});

console.log('Finished installing plugin in Alan Turing test Obsidian vault');
