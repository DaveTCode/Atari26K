.ONESHELL:

build: build_wasm build_web

build_wasm:
	cargo build --verbose
	wasm-pack build

build_web:
	cd www
	npm install
	npm run build

test: build
	cargo test --verbose

run: build
	cd www
	npm run start

clean:
	rm -rf pkg target
	cd www
	rm -rf dist node_modules
