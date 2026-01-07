# Client Patterns

Clients are components that request and render data. Mosaic supports both class-based extensions and functional wrappers for web frameworks.

## MosaicClient Class

To create a custom client, extend the `MosaicClient` class and override the necessary methods.

```js
class MyClient extends MosaicClient {
  query(filter) {
    return Query.from('table').select('*').where(filter);
  }

  queryResult(data) {
    this.render(data);
    return this;
  }
}

makeClient Utility
// The makeClient function is a helper for integrating with frameworks like React or Svelte.
makeClient(options)
options.coordinator: The Coordinator instance.
options.selection: (Optional) A Selection to filter the client.
options.query: Function that returns a SQL query given a filter.
options.queryResult: Function called when data is returned.
options.queryPending: (Optional) Function called when a query starts.
options.queryError: (Optional) Function called when an error occurs.
// Optimization Properties
filterStable
client.filterStable
// Return true if the structure of the client's query (e.g., group by bins) does not change when the filter changes. This allows the Coordinator to apply pre-aggregation optimizations.
```
