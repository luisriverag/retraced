import * as Auth0 from "auth0-js";
import { LocalStorage } from "node-localstorage";

import getUser from "../models/user/getByExternalAuth";
import createUser, { ERR_DUPLICATE_EMAIL } from "../models/user/create";
import getInvite from "../models/invite/get";
import deleteInvite from "../models/invite/delete";
import addUserToProject from "../models/project/addUser";
import { createAdminVoucher } from "../security/vouchers";

let auth0;

if (process.env.AUTH0_CLIENT_DOMAIN && process.env.AUTH0_CLIENT_ID) {
  auth0 = new Auth0.WebAuth({
    domain: process.env.AUTH0_CLIENT_DOMAIN,
    clientID: process.env.AUTH0_CLIENT_ID,
    callbackURL: "",
    leeway: 30,
  });
}

// This is to appease the Auth0 lib, which expects to be running in a browser. -_-
global["window"] = {
  localStorage: new LocalStorage("./auth0"),
};

export default async function handler(req) {
  if (!req.body.external_auth) {
    throw { status: 400, err: new Error("Missing required auth") };
  }

  const externalAuth: ExternalAuth = await validateExternalAuth(req.body.external_auth);

  return await createSession(externalAuth);
}

export async function createSession(externalAuth: ExternalAuth) {
  let user = await getUser({
    email: externalAuth.email,
    authId: externalAuth.upstreamToken,
  });
  if (!user) {
    try {
      user = await createUser({
        email: externalAuth.email,
        authId: externalAuth.upstreamToken,
      });
    } catch (err) {
      if (err === ERR_DUPLICATE_EMAIL) {
        throw { status: 409, err: new Error("Email already exists") };
      }
      throw err;
    }
  }

  let invite;
  if (externalAuth.inviteId) {
    // This login attempt is the direct result of someone following an invitation link.
    // This means we can look up the invitation directly by its id.
    // Ergo, this user can register with any e-mail address provided to us by Auth0.
    invite = await getInvite({ inviteId: externalAuth.inviteId });
  } else {
    // Otherwise, we still check to see if this email has a pending invite, just in case.
    invite = await getInvite({ email: externalAuth.email });
  }

  if (invite) {
    console.log(`Found invite for user: ${externalAuth.email} / ${externalAuth.upstreamToken}, adding them to project '${invite.project_id}'`);
    await addUserToProject({
      userId: user.id,
      projectId: invite.project_id,
    });
    await deleteInvite({
      inviteId: invite.id,
      projectId: invite.project_id,
    });
  }

  const voucher = createAdminVoucher({
    userId: user.id,
  });

  const response = {
    user: {
      email: user.email,
      id: user.id,
      timezone: user.timezone,
    },
    token: voucher,
  };

  return {
    status: 200,
    body: JSON.stringify(response),
  };
}

export interface ExternalAuth {
  email: string;
  upstreamToken: string;
  inviteId?: string;
}

function validateExternalAuth(payload: string): Promise<ExternalAuth> {
  return new Promise<ExternalAuth>((resolve, reject) => {
    if (!auth0) {
      reject("Auth0 not initialized, admin sessions not available");
      return;
    }
    auth0.parseHash({ hash: payload }, (err, data) => {
      if (err) {
        reject(err);
        return;
      }
      resolve({
        email: data.idTokenPayload.email,
        upstreamToken: data.idTokenPayload.sub,
        inviteId: data.state,
      });
    });
  });
}
