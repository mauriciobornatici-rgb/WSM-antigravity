// req.ip already honours the TRUST_PROXY setting; reading X-Forwarded-For directly
// would let any client forge the IP recorded in audit logs.
export default function getRequestIp(req) {
    return req.ip;
}
