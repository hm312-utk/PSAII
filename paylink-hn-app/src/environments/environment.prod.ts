export const environment = {
  production: true,
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