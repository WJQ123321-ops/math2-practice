import cloudbase from '@cloudbase/js-sdk';
// __MATH2_ENV__ and __MATH2_REGION__ are injected at build time by scripts/build.cjs
// from your .env (CLOUDBASE_ENV / CLOUDBASE_REGION). The environment id is a public
// identifier and is safe in front-end code; secret keys are never bundled here.
export const app=cloudbase.init({env:__MATH2_ENV__,region:__MATH2_REGION__});
export const auth=app.auth({persistence:'local'});
