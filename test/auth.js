import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import assert from 'assert';
import { CognitoUser, CognitoUserPool } from 'amazon-cognito-identity-js';
import AWS from 'aws-sdk/global';
import { authenticate, performLogin, refresh } from '../src/auth';

chai.use(chaiAsPromised);
chai.use(sinonChai);
const expect = chai.expect;

sinon
  .stub(AWS.CognitoIdentityCredentials.prototype, 'refresh')
  .callsFake(function f(callback) {
    const username = this.params.LoginId;
    switch (username) {
      case 'identity-pool-failure':
        callback('bad refresh in test');
        break;
      case 'success':
      case 'email-verification-required':
        callback();
        break;
      default:
        assert(false, 'unrecognised username in credentials refresh');
    }
  });

const mockSession = {
  getIdToken: () => ({
    getJwtToken: () => 'jwt_token',
  }),
  getRefreshToken: () => ({
    getJwtToken: () => 'jwt_refresh_token',
  }),
};

sinon
  .stub(CognitoUser.prototype, 'getAttributeVerificationCode')
  .callsFake((attribute, callbacks) => callbacks.inputVerificationCode());

sinon
  .stub(CognitoUser.prototype, 'getUserAttributes')
  .callsFake(function f(callback) {
    const verified =
      this.username === 'email-verification-required' ? 'false' : 'true';
    callback(undefined, [
      {
        getName: () => 'email_verified',
        getValue: () => verified,
      },
    ]);
  });

sinon.stub(CognitoUser.prototype, 'getSession').callsFake(function f(callback) {
  switch (this.username) {
    case 'session-error':
      callback(true, null);
      break;
    case 'success':
    case 'email-verification-required':
      callback(false, mockSession);
      break;
    default:
      assert(false, 'unrecognised username in getSession stub');
  }
});

sinon.stub(CognitoUser.prototype, 'authenticateUser').callsFake((creds, f) => {
  switch (creds.username) {
    case 'success':
    case 'session-error':
    case 'email-verification-required':
      f.onSuccess();
      break;
    case 'failure-bad-creds':
      f.onFailure({ code: 'NotAuthorizedException' });
      break;
    case 'failure-not-confirmed':
      f.onFailure({ code: 'UserNotConfirmedException' });
      break;
    case 'mfa':
      f.mfaRequired();
      break;
    case 'newpass':
      f.newPasswordRequired();
      break;
    default:
      assert(false, 'unrecognised username in authenticateUser stub');
      break;
  }
});

sinon
  .stub(CognitoUser.prototype, 'refreshSession')
  .callsFake((refreshToken, callback) => {
    switch (refreshToken.token) {
      case 'success':
        callback(null, mockSession);
        break;
    }
  });

describe('performLogin', () => {
  it('should return loginFailure action when session error', () => {
    const user = new CognitoUser({
      Username: 'session-error',
      Pool: new CognitoUserPool({
        UserPoolId: 'eu-west-1_testpool',
        ClientId: 'testclient',
      }),
    });
    expect(performLogin(user, {}))
      .to.eventually.have.property('type')
      .to.equal('COGNITO_LOGIN_FAILURE');
  });
});

/** @test {authenticate} */
// cannot stub performLogin, and useful to test entire orchestration
describe('authenticate', () => {
  const pool = new CognitoUserPool({
    UserPoolId: 'eu-west-1_testpool',
    ClientId: 'testclient',
  });
  const mockDispatch = sinon.stub().callsFake(action => {
    return action.type;
  });
  const a = username => authenticate(username, '', pool, {}, mockDispatch);

  it('should return nothing and dispatch authenticated on success', () => {
    expect(a('success')).to.eventually.equal();
    expect(mockDispatch.lastCall).to.have.returned('COGNITO_AUTHENTICATED');
  });

  /** @test {authenticate#failed passwords} */
  it('should return a NotAuthorizedException for failed passwords', () =>
    expect(a('failure-bad-creds'))
      .to.be.rejected.and.eventually.have.property('code')
      .to.equal('NotAuthorizedException'));

  /** @test {authenticate#not confirmed} */
  it('should return nothing and dispatch confirmed when not confirmed', () => {
    expect(a('failure-not-confirmed')).to.eventually.equal();
    expect(mockDispatch.lastCall).to.have.returned('COGNITO_USER_UNCONFIRMED');
  });

  it('should return nothing and dispatch mfa when MFA is required', () => {
    expect(a('mfa')).to.eventually.equal();
    expect(mockDispatch.lastCall).to.have.returned(
      'COGNITO_LOGIN_MFA_REQUIRED'
    );
  });

  it('should return nothing dispatch newPasswordRequired when new password is required', () => {
    expect(a('newpass')).to.eventually.equal();
    expect(mockDispatch.lastCall).to.have.returned(
      'COGNITO_LOGIN_NEW_PASSWORD_REQUIRED'
    );
  });
});

/** @test {refresh} */
describe('refresh', () => {
  const pool = new CognitoUserPool({
    UserPoolId: 'eu-west-1_testpool',
    ClientId: 'testclient',
  });
  const mockDispatch = sinon.stub().callsFake(action => {
    return action.type;
  });
  const a = token => refresh(pool, '', token, mockDispatch);

  it('should return nothing and dispatch refresh on success', () => {
    expect(a('success')).to.eventually.equal();
    expect(mockDispatch.lastCall).to.have.returned('COGNITO_REFRESH');
  });
});
