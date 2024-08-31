import querystring from 'node:querystring'
import { Grant, Config, Token, grantSchema, UserInfo, baseTokenSchema, userInfoSchema } from './schemas'
import { z } from 'zod'
import crypto from 'crypto'

export class QuickBooks {
  // Properties
  readonly clientId: string
  readonly clientSecret: string
  readonly redirectUri: string
  readonly responseType: string
  readonly authorizeEndpoint: string
  readonly tokenEndpoint: string
  readonly revokeEndpoint: string
  readonly userEndpoint: string
  readonly apiEndpoint: string
  readonly scopes: { [key: string]: string }
  readonly accessTokenLatency: number
  readonly refreshTokenLatency: number
  readonly minorversion: string

  // Constructor
  constructor(config: Config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.redirectUri = config.redirectUri
    this.responseType = 'code'
    this.authorizeEndpoint = 'https://appcenter.intuit.com/connect/oauth2'
    this.tokenEndpoint = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
    this.revokeEndpoint = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke'
    this.userEndpoint =
      config.environment === 'production'
        ? 'https://accounts.platform.intuit.com/v1/openid_connect/userinfo'
        : 'https://sandbox-accounts.platform.intuit.com/v1/openid_connect/userinfo'
    this.apiEndpoint =
      config.environment === 'production'
        ? 'https://quickbooks.api.intuit.com'
        : 'https://sandbox-quickbooks.api.intuit.com'
    this.scopes = {
      accounting: 'com.intuit.quickbooks.accounting',
      // Payment: 'com.intuit.quickbooks.payment',
      // Payroll: 'com.intuit.quickbooks.payroll',
      // TimeTracking: 'com.intuit.quickbooks.payroll.timetracking',
      // Benefits: 'com.intuit.quickbooks.payroll.benefits',
      profile: 'profile',
      email: 'email',
      phone: 'phone',
      address: 'address',
      openid: 'openid',
      // IntuitName: 'intuit_name',
    }
    this.minorversion = '65'
    this.accessTokenLatency = 60 // 60 seconds
    this.refreshTokenLatency = 60 * 60 * 24 * 3 // three days
  }

  getUnixTimestamp() {
    return Math.floor(Date.now() / 1000)
  }

  // Generate a random string that is 32 characters long (two characters per byte)
  createStateString() {
    return crypto.randomBytes(16).toString('hex')
  }

  // Methods
  getAuthUrl() {
    const query = querystring.encode({
      client_id: this.clientId,
      response_type: this.responseType,
      state: this.createStateString(),
      scope: [
        this.scopes.accounting,
        this.scopes.openid,
        this.scopes.profile,
        this.scopes.email,
        this.scopes.phone,
        this.scopes.address,
      ].join(' '),
      redirect_uri: this.redirectUri,
    })
    return `${this.authorizeEndpoint}?${query}`
  }

  isAccessTokenValid(token: Token) {
    return token.expires_at > this.getUnixTimestamp()
    // const isValid = token.created_at + token.expires_in > this.getUnixTimestamp()
    // return isValid
  }

  isRefreshTokenValid(token: Token) {
    return token.x_refresh_token_expires_at > this.getUnixTimestamp()
    // const isValid = token.created_at + token.x_refresh_token_expires_in > this.getUnixTimestamp()
    // return isValid
  }

  parseToken(token: any, realm_id: string): Token {
    // console.log(token)
    // token = baseTokenSchema.parse(token)
    return {
      ...token,
      realm_id,
      expires_at: this.getUnixTimestamp() + token.expires_in - this.accessTokenLatency,
      x_refresh_token_expires_at: this.getUnixTimestamp() + token.x_refresh_token_expires_in - this.refreshTokenLatency,
    }
  }

  getAuthHeader() {
    return Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')
  }

  async getTokenFromGrant(grant: Grant): Promise<Token> {
    grantSchema.parse(grant)

    const body = {
      grant_type: 'authorization_code',
      code: grant.code,
      redirect_uri: this.redirectUri,
    }

    // Post the body object to the token endpoint
    // const encodedBody = querystring.encode(body)

    // const res = await axios.post(this.tokenEndpoint, encodedBody, {
    //   headers: {
    //     Authorization: `Basic ${this.getAuthHeader()}`,
    //     'Content-Type': 'application/x-www-form-urlencoded',
    //     Accept: 'application/json',
    //   },
    // })

    // Rewrite the above block using fetch
    const res = await fetch(this.tokenEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${this.getAuthHeader()}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: querystring.encode(body),
    })

    const data = await res.json()

    // Parse the response as JSON and return it
    // Manually add the created_at property
    // Subtracting 10 seconds of latency to the created_at property
    // to ensure the token is detected as expired before it actually is
    const token = this.parseToken(data, grant.realmId)
    return token
  }

  async getRefreshedToken(token: Token): Promise<Token> {
    const body = { grant_type: 'refresh_token', refresh_token: token.refresh_token }
    // const encodedBody = querystring.encode(body)

    // const res = await axios.post(this.tokenEndpoint, encodedBody, {
    //   headers: {
    //     Authorization: `Basic ${this.getAuthHeader()}`,
    //     'Content-Type': 'application/x-www-form-urlencoded',
    //     Accept: 'application/json',
    //   },
    // })

    const res = await fetch(this.tokenEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${this.getAuthHeader()}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: querystring.encode(body),
    })

    const data = await res.json()
    const refreshedToken = this.parseToken(data, token.realm_id)
    return refreshedToken
  }

  async getUserInfo(token: Token): Promise<UserInfo> {
    // // Use axios to get the user info
    // const res = await axios.get(this.userEndpoint, {
    //   headers: {
    //     Authorization: `Bearer ${token.access_token}`,
    //     Accept: 'application/json',
    //   },
    // })

    const res = await fetch(this.userEndpoint, {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        Accept: 'application/json',
      },
    })

    const data = await res.json()
    console.log(data)
    const userInfo = userInfoSchema.parse(data)
    return userInfo
  }

  async getCompanyInfo(token: Token): Promise<any> {
    // Build the url
    const url = `${this.apiEndpoint}/v3/company/${token.realm_id}/companyinfo/${token.realm_id}?minorversion=${this.minorversion}`

    // Use axios to get the company info
    // const res = await axios.get(url, {
    //   headers: {
    //     Authorization: `Bearer ${token.access_token}`,
    //     Accept: 'application/json',
    //   },
    // })

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        Accept: 'application/json',
      },
    })

    const data = await res.json()

    // Check if data has a property called CompanyInfo
    const parsed = z.object({ CompanyInfo: z.any() }).parse(data)

    return parsed.CompanyInfo
  }

  async apiGet(token: Token, path: string) {
    // Build the url
    const url = `${this.apiEndpoint}/v3/company/${token.realm_id}${path}&minorverion=${this.minorversion}`

    // const res = await axios.get(url, {
    //   headers: {
    //     Authorization: `Bearer ${token.access_token}`,
    //     Accept: 'application/json',
    //   },
    // })

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        Accept: 'application/json',
      },
    })

    const data = await res.json()

    return data
  }

  async apiPost(token: Token, path: string, body: any) {
    const url = `${this.apiEndpoint}/v3/company/${token.realm_id}${path}`

    // const res = await axios.post(url, body, {
    //   headers: {
    //     Authorization: `Bearer ${token.access_token}`,
    //     Accept: 'application/json',
    //     'Content-Type': 'application/json',
    //   },
    // })

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    const data = await res.json()

    return data
  }

  async revokeAccess(token: Token) {
    const body = { token: token.access_token }
    // const encodedBody = querystring.encode(body)

    // const res = await axios.post(this.revokeEndpoint, body, {
    //   headers: {
    //     Authorization: `Basic ${this.getAuthHeader()}`,
    //     'Content-Type': 'application/json',
    //     Accept: 'application/json',
    //   },
    // })

    const res = await fetch(this.revokeEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${this.getAuthHeader()}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    })

    const data = await res.json()
    return data
  }
}
