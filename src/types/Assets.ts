interface Asset {
    type: string;
    key: string;
}

export interface AssetManifest {
    baseURL: string;
    assets: Asset[];
}