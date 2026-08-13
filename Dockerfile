# hugmesh-user-ui — builds the User native-federation REMOTE
# (src → dist/user) and serves it via nginx with CORS so the
# hugmesh.systems host can fetch its remoteEntry.json cross-origin.
# Deployed to the hugmesh-frontend namespace, fronted by the fe-gateway at
# /user. ROLE_USER guarded by the host; paired with hugmesh-user-bff-api.
# Angular CLI 22 requires Node >= 24.15.
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build:user -- --base-href=/user/

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/user/browser /usr/share/nginx/html
EXPOSE 80
