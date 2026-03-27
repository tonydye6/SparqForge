export interface TwitterTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type: string;
  scope: string;
}

export interface TwitterUserResponse {
  data: {
    id: string;
    username: string;
    name: string;
  };
}

export interface FacebookTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
}

export interface FacebookPagesResponse {
  data: Array<{
    id: string;
    name: string;
    access_token: string;
  }>;
}

export interface FacebookPageIGResponse {
  instagram_business_account?: {
    id: string;
  };
}

export interface InstagramUserResponse {
  username?: string;
  id: string;
}

export interface LinkedInTokenResponse {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  token_type: string;
}

export interface LinkedInProfileResponse {
  sub?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  email?: string;
}

export interface TikTokTokenResponse {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_expires_in?: number;
  token_type: string;
  scope: string;
  open_id?: string;
}

export interface TikTokUserInfoResponse {
  data?: {
    user?: {
      open_id?: string;
      display_name?: string;
      avatar_url?: string;
      union_id?: string;
    };
  };
  error?: {
    code: string;
    message: string;
  };
}
