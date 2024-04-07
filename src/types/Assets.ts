interface Asset {
    type: string;
    key: string;
    file: string;
}

export interface AssetManifest {
    baseURL: string;
    assets: Asset[];
}