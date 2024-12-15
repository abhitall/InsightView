import { AuthStrategy, FormAuthStrategy, TokenAuthStrategy, OAuthStrategy, BasicAuthStrategy } from './authStrategies';

export class AuthStrategyFactory {
  static createStrategy(type: string): AuthStrategy | null {
    switch (type.toLowerCase()) {
      case 'form':
        return new FormAuthStrategy();
      case 'token':
        return new TokenAuthStrategy();
      case 'oauth':
        return new OAuthStrategy();
      case 'basic':
        return new BasicAuthStrategy();
      default:
        return null;
    }
  }
}