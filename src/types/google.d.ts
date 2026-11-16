// Minimal types for Google Identity Services (token model) and the Google Picker,
// loaded at runtime from accounts.google.com and apis.google.com.

declare namespace google.accounts.oauth2 {
  interface TokenResponse {
    access_token: string;
    expires_in: number | string;
    scope: string;
    token_type: string;
    error?: string;
    error_description?: string;
  }
  interface ClientConfigError {
    type: "popup_failed_to_open" | "popup_closed" | "unknown";
    message?: string;
  }
  interface TokenClientConfig {
    client_id: string;
    scope: string;
    callback: (response: TokenResponse) => void;
    error_callback?: (error: ClientConfigError) => void;
    prompt?: string;
    include_granted_scopes?: boolean;
  }
  interface OverridableTokenClientConfig {
    prompt?: "" | "none" | "consent" | "select_account";
    login_hint?: string;
  }
  interface TokenClient {
    requestAccessToken(overrides?: OverridableTokenClientConfig): void;
  }
  function initTokenClient(config: TokenClientConfig): TokenClient;
  function revoke(accessToken: string, done?: () => void): void;
  function hasGrantedAllScopes(response: TokenResponse, ...scopes: string[]): boolean;
}

declare namespace google.picker {
  enum ViewId {
    DOCS = "all",
  }
  enum Feature {
    MULTISELECT_ENABLED = "multiselectEnabled",
  }
  enum Action {
    PICKED = "picked",
    CANCEL = "cancel",
    LOADED = "loaded",
  }
  interface PickerDocument {
    id: string;
    name: string;
    mimeType: string;
    sizeBytes?: number | string;
    lastEditedUtc?: number;
    url?: string;
  }
  interface ResponseObject {
    action: string;
    docs?: PickerDocument[];
  }
  class DocsView {
    constructor(viewId?: ViewId);
    setMimeTypes(mimeTypes: string): DocsView;
    setOwnedByMe(me?: boolean): DocsView;
    setIncludeFolders(include: boolean): DocsView;
    setSelectFolderEnabled(enabled: boolean): DocsView;
    setLabel(label: string): DocsView;
    setMode(mode: string): DocsView;
  }
  class Picker {
    setVisible(visible: boolean): void;
    dispose(): void;
  }
  class PickerBuilder {
    setAppId(appId: string): PickerBuilder;
    setOAuthToken(token: string): PickerBuilder;
    setDeveloperKey(key: string): PickerBuilder;
    enableFeature(feature: Feature): PickerBuilder;
    addView(view: DocsView): PickerBuilder;
    setCallback(cb: (data: ResponseObject) => void): PickerBuilder;
    setOrigin(origin: string): PickerBuilder;
    setTitle(title: string): PickerBuilder;
    setMaxItems(max: number): PickerBuilder;
    build(): Picker;
  }
}

declare namespace gapi {
  function load(api: string, options: { callback: () => void; onerror?: () => void; timeout?: number; ontimeout?: () => void }): void;
}
