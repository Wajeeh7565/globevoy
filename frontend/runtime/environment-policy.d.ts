interface PublicEnvironment {
  environment: 'production' | 'staging' | 'development' | 'unknown';
  apiBaseUrl: string;
  accountsEnabled: boolean;
  worldwideRegistryEnabled: boolean;
  automaticDatesEnabled: boolean;
  reactEnabled: boolean;
  auth: null | { region: string; userPoolId: string; clientId: string; issuer: string; domainBaseUrl: string };
}
declare const policy: {
  productionApi: string; stagingApi: string; stagingOrigin: string;
  stagingAuth: NonNullable<PublicEnvironment['auth']>;
  resolve(origin: string, developmentApi?: string): PublicEnvironment;
};
export default policy;
