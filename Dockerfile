FROM node:20-alpine AS development-dependencies-env
RUN apk add --no-cache python3 py3-pip
COPY . /app
WORKDIR /app
RUN npm ci

FROM node:20-alpine AS production-dependencies-env
COPY ./package.json package-lock.json /app/
WORKDIR /app
RUN npm ci --omit=dev

FROM node:20-alpine AS build-env
COPY . /app/
COPY --from=development-dependencies-env /app/node_modules /app/node_modules
WORKDIR /app
RUN npm run build

FROM node:20-alpine
RUN apk add --no-cache python3 py3-pip \
	&& pip install --no-cache-dir --break-system-packages requests==2.31.0
COPY ./package.json package-lock.json /app/
COPY ./cr_api_runner.py /app/cr_api_runner.py
COPY --from=production-dependencies-env /app/node_modules /app/node_modules
COPY --from=build-env /app/build /app/build
WORKDIR /app
ENV HOST=0.0.0.0
CMD ["npm", "run", "start"]