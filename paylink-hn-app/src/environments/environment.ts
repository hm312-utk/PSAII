// This file can be replaced during build by using the `fileReplacements` array.
// `ng build` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.

export const environment = {
  production: false,
  apiUrl: 'http://192.168.174.136:3001/api',
  apiKey: '1234567891011121314', 
  merchantId: 'COMERCIO-001',
  googlePay: {
    environment: 'TEST' as any,
    merchantId: '01234567890123456789', 
    merchantName: 'Restaurante de Prueba',
    currencyCode: 'USD',
    tokenization: {
      type: 'PAYMENT_GATEWAY' as any,
      parameters: {
        gateway: 'example',
        gatewayMerchantId: 'exampleGatewayMerchantId'
      } as any
    }
  }
};

/*
 * For easier debugging in development mode, you can import the following file
 * to ignore zone related error stack frames such as `zone.run`, `zoneDelegate.invokeTask`.
 *
 * This import should be commented out in production mode because it will have a negative impact
 * on performance if an error is thrown.
 */
// import 'zone.js/plugins/zone-error';  // Included with Angular CLI.
