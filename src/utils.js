
import { CognitoIdentityCredentials } from 'aws-cognito-sdk';
import { Action } from './actions';

// could perhaps be done with an import, but I am uncertain
/* global AWSCognito */
const changePassword = (user, oldPassword, newPassword) =>
  new Promise((resolve, reject) =>
    user.changePassword(oldPassword, newPassword, (err, result) => {
      if (err) {
        reject(err.message);
      } else {
        resolve(result);
      }
    }));

const sendAttributeVerificationCode = (user, attribute) =>
  new Promise((resolve, reject) => {
    user.getAttributeVerificationCode(attribute, {
      onSuccess: () => resolve(false),
      inputVerificationCode: () => resolve(true),
      onFailure: error => reject(error.message),
    });
  });

const getUserAttributes = user =>
  new Promise((resolve, reject) => {
    user.getUserAttributes((error, result) => {
      if (error) {
        reject(error.message);
      } else {
        const attributes = {};
        for (let i = 0; i < result.length; i += 1) {
          const name = result[i].getName();
          const value = result[i].getValue();
          attributes[name] = value;
        }
        resolve(attributes);
      }
    });
  });

const emailVerificationFlow = (user, attributes) =>
  new Promise((resolve) => {
    sendAttributeVerificationCode(user, 'email').then((required) => {
      if (required) {
        resolve(Action.emailVerificationRequired(user, attributes));
      } else {
        // dead end?
        resolve(Action.login(user, attributes));
      }
    }, (error) => {
      // some odd classes of error here
      resolve(Action.emailVerificationFailed(user, error, attributes));
    });
  });

const loginOrVerifyEmail = (user, config) =>
  new Promise((resolve) => {
    // we default to mandatory
    const mandatory = !(config && config.mandatoryEmailVerification === false);
    getUserAttributes(user).then((attributes) => {
      if (mandatory && (attributes.email_verified !== 'true')) {
        resolve(emailVerificationFlow(user, attributes));
      } else {
        resolve(Action.login(user, attributes));
      }
    });
  });

const buildIdentityCredentials = (username, jwtToken, config) => {
  const loginDomain = `cognito-idp.${config.region}.amazonaws.com`;
  const loginUrl = `${loginDomain}/${config.userPool}`;
  const creds = {
    IdentityPoolId: config.identityPool,
    Logins: {},
    LoginId: username, // https://github.com/aws/aws-sdk-js/issues/609
  };
  creds.Logins[loginUrl] = jwtToken;
  return creds;
};

const refreshIdentityCredentials = (username, jwtToken, config) =>
  new Promise((resolve, reject) => {
    const creds = buildIdentityCredentials(username, jwtToken, config);
    AWSCognito.config.credentials = new CognitoIdentityCredentials(creds);
    AWSCognito.config.credentials.refresh((error) => {
      if (error) {
        reject(error.message);
      } else {
        resolve();
      }
    });
  });

const performLogin = (user, config) =>
  new Promise((resolve, reject) => {
    if (user != null) {
      user.getSession((err, session) => {
        if (err) {
          resolve(Action.loginFailure(user, err.message));
        } else {
          const jwtToken = session.getIdToken().getJwtToken();
          const username = user.getUsername();
          refreshIdentityCredentials(username, jwtToken, config).then(
            () => resolve(loginOrVerifyEmail(user, config)),
            message => resolve(Action.loginFailure(user, message)));
        }
      });
    } else {
      reject('user is null');
    }
  });

const updateAttributes = (user, attributes, config) =>
  new Promise((resolve, reject) => {
    const attributeList = Object.keys(attributes).map(key => ({
      Name: key,
      Value: attributes[key],
    }));
    user.updateAttributes(attributeList, (err) => {
      if (err) {
        reject(err.message);
      } else if (config.mandatoryEmailVerification) {
        resolve(loginOrVerifyEmail(user, config));
      } else {
        resolve(Action.updateAttributes(attributes));
      }
    });
  });

export { changePassword, loginOrVerifyEmail, performLogin, updateAttributes };