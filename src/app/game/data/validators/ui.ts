// Validators for the scene/HUD manifests: assets, config, input, toolAssets. Deliberately cheap — these are
// small files whose failures were previously runtime-visible (a missing sprite, a dead key) but never explained.

import { checkArray, checkBoolean, checkEnum, checkRecord, checkString, checkUnknownKeys } from 'game/data/checks';
import { IssueCollector } from 'game/data/registry';
import { Tool } from 'types/Cursor';

const TOOLS = Object.values(Tool) as string[];

export function validateAssetsStructure(data: unknown, issues: IssueCollector): void {
    if (!checkRecord(issues, '', data)) {
        return;
    }
    checkUnknownKeys(issues, '', data, ['baseURL', 'assets']);
    checkString(issues, 'baseURL', data['baseURL']);
    if (!checkArray(issues, 'assets', data['assets'])) {
        return;
    }
    const seen = new Set<string>();
    (data['assets'] as unknown[]).forEach((asset, index) => {
        const path = `assets[${index}]`;
        if (!checkRecord(issues, path, asset)) {
            return;
        }
        checkUnknownKeys(issues, path, asset, ['type', 'key']);
        checkEnum(issues, `${path}.type`, asset['type'], ['image']);
        if (checkString(issues, `${path}.key`, asset['key'])) {
            const key = asset['key'] as string;
            if (seen.has(key)) {
                issues.add(`${path}.key`, `duplicate asset key "${key}"`);
            }
            seen.add(key);
        }
    });
}

export function validateConfigStructure(data: unknown, issues: IssueCollector): void {
    if (!checkRecord(issues, '', data)) {
        return;
    }
    checkUnknownKeys(issues, '', data, ['debug']);
    if (!checkRecord(issues, 'debug', data['debug'])) {
        return;
    }
    const debug = data['debug'] as Record<string, unknown>;
    checkUnknownKeys(issues, 'debug', debug, ['masterSwitch', 'spawnKeys', 'drawCurbs', 'drawLanes', 'drawTileDepth', 'autoLoad']);
    for (const flag of ['masterSwitch', 'spawnKeys', 'drawCurbs', 'drawLanes', 'drawTileDepth']) {
        checkBoolean(issues, `debug.${flag}`, debug[flag]);
    }
    if (checkRecord(issues, 'debug.autoLoad', debug['autoLoad'])) {
        const autoLoad = debug['autoLoad'] as Record<string, unknown>;
        checkUnknownKeys(issues, 'debug.autoLoad', autoLoad, ['enabled', 'save']);
        checkBoolean(issues, 'debug.autoLoad.enabled', autoLoad['enabled']);
        checkString(issues, 'debug.autoLoad.save', autoLoad['save'], false);
    }
}

export function validateInputStructure(data: unknown, issues: IssueCollector): void {
    if (!checkRecord(issues, '', data)) {
        return;
    }
    checkUnknownKeys(issues, '', data, ['inputMappings']);
    if (!checkArray(issues, 'inputMappings', data['inputMappings'])) {
        return;
    }
    const seen = new Set<string>();
    (data['inputMappings'] as unknown[]).forEach((mapping, index) => {
        const path = `inputMappings[${index}]`;
        if (!checkRecord(issues, path, mapping)) {
            return;
        }
        checkUnknownKeys(issues, path, mapping, ['key', 'tool']);
        if (checkString(issues, `${path}.key`, mapping['key'])) {
            const key = mapping['key'] as string;
            if (seen.has(key)) {
                issues.add(`${path}.key`, `key "${key}" is bound twice`);
            }
            seen.add(key);
        }
        checkEnum(issues, `${path}.tool`, mapping['tool'], TOOLS);
    });
}

export function validateToolAssetsStructure(data: unknown, issues: IssueCollector): void {
    if (!checkRecord(issues, '', data)) {
        return;
    }
    for (const [tool, spriteKey] of Object.entries(data)) {
        if (!TOOLS.includes(tool)) {
            issues.add(tool, `unknown tool (allowed: ${TOOLS.join(', ')})`);
        }
        checkString(issues, tool, spriteKey);
    }
}

export function validateToolAssetsSemantics(data: unknown, peers: Record<string, unknown>, issues: IssueCollector): void {
    const manifest = peers['assets'] as { assets?: { key: string }[] } | undefined;
    const knownKeys = new Set((manifest?.assets ?? []).map(asset => asset.key));
    for (const [tool, spriteKey] of Object.entries(data as Record<string, string>)) {
        if (!knownKeys.has(spriteKey)) {
            issues.add(tool, `sprite key "${spriteKey}" is not in assets.json`);
        }
    }
}
