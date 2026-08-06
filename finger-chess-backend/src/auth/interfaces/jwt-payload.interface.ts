export interface JwtPayload {
  sub: string; // user id
  email: string;
  role: string;
}

// `request.user` shape produced by JwtRefreshStrategy — mirrors the access
// strategy's `{ userId, email, role }` contract so controllers can treat both
// guard results identically.
export interface JwtPayloadWithRefreshToken {
  userId: string;
  email: string;
  role: string;
  refreshToken: string;
}
