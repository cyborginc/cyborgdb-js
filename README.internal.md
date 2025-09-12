**Testing**

To run the quickflow integration test that simulates real user usage:

```bash
# 1. Build the package
npm run build

# 2. Create a package tarball
npm pack

# 3. Install the local package (replace x.x.x with your version)
npm install cyborgdb-x.x.x.tgz

# 4. Run the quickflow test
npm run test:quickflow
```

This test imports and uses the `cyborgdb` package exactly as an end user would, ensuring the package works correctly when installed as a dependency.
