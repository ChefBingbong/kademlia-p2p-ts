**implementation of the the Kademlia distributed hash table algorithm in typescript. this repo is currenly a work in prgress**

# Kademlia DHT Implementation

This repository contains an implementation of the Kademlia Distributed Hash Table (DHT), a foundational component in many peer-to-peer (P2P) systems like BitTorrent, IPFS, and others. Kademlia provides a way for nodes in a distributed network to efficiently locate resources without the need for centralized servers.

## Table of Contents

- [Overview](#overview)
- [What is Kademlia?](#what-is-kademlia)
- [Key Components](#key-components)
  - [Routing Table](#routing-table)
  - [Buckets](#buckets)
  - [Node ID & XOR Metric](#node-id--xor-metric)
  - [Recursive Peer Discovery Algorithm](#recursive-peer-discovery-algorithm)
- [Protocol Overview](#protocol-overview)
- [How This Implementation Works](#how-this-implementation-works)
- [Installation & Usage](#installation--usage)
- [Contributing](#contributing)
- [License](#license)

## Overview

The Kademlia DHT (Distributed Hash Table) is a decentralized system that allows nodes (peers) in a network to store and retrieve values associated with keys, without the need for a central authority. It uses a unique combination of peer-to-peer networking and a binary tree-like structure to ensure that any node can find other nodes and locate resources efficiently, even as nodes join or leave the network.

This repository provides a full implementation of the Kademlia protocol, including:

- **Routing Table managemen**t with efficient lookup mechanisms
- **Bucket-based storage** and peer discovery
- **Recursive lookup algorithm** for locating peers or values

## What is Kademlia?

Kademlia is a protocol designed for decentralized networks that organizes nodes using a unique, node-specific ID. These IDs are used to route requests across the network and find specific nodes and resources. Kademlia uses XOR distance as its metric for determining how close two nodes are to each other in the network.

The Kademlia DHT is highly resilient and scalable, making it suitable for large, dynamic P2P networks. Kademlia provides efficient:

- **Key-Value Lookups**: Any node can store and retrieve key-value pairs, distributed across the network.
- **Peer Discovery**: Nodes can find other peers by their node ID through recursive lookups.
- **Fault Tolerance**: The structure of Kademlia ensures robustness in the presence of network churn (nodes joining or leaving).

## Key Components

### Routing Table

Each node in a Kademlia network maintains a routing table that holds the IDs and addresses of other nodes. The routing table is broken into "buckets," which are lists of nodes grouped by how far away they are (in terms of XOR distance) from the local node.

- **Bucket Structure**: Nodes in the routing table are organized into buckets based on their XOR distance from the local node.
- **Routing Efficiency**: The routing table ensures that nodes maintain connections with both close and distant peers, balancing efficiency with network coverage.

### Buckets

Kademlia uses buckets to group nodes with similar XOR distances to the local node.

- **Number of Buckets**: Determined by the length of the node ID. For a 160-bit ID (e.g., SHA-1 hashed IDs), each node will have 160 buckets. However for this implementation the base code uses 16 BIT NodeIds so we have 4 buckets. This is simple just for ease of testing when it comes to manually verifying the nodes's buvkets contain the correct peers
- **Bucket Size**: Each bucket can store a fixed number of nodes (typically `k = 20`), however in my implementation our bucket size is 4. When a bucket is full, Kademlia uses a least-recently-seen strategy to evict inactive nodes. **However my implementation currently hasn't implemented this part of the algorithm ye, but its coming soon**

### Node ID & XOR Metric

Each node in Kademlia is assigned a Node ID, typically a randomly generated value of fixed bit-length.

- **XOR Metric**: The distance between two node IDs is calculated using the XOR operation. The result is interpreted as a binary number representing the "distance" between the two nodes.
- **Closeness**: The lower the XOR value between two nodes, the closer they are considered in the network.

### Recursive Peer Discovery Algorithm

Kademlia's recursive peer discovery mechanism allows nodes to efficiently locate other nodes or resources.

1. **Lookup Initiation**: The node queries the closest known nodes to the target key/node.
2. **Closest Nodes Query**: These queried nodes respond with a list of the closest nodes they know of.
3. **Iterative Process**: The requesting node updates its view of the network and repeats the process, converging on the closest node.
4. **Termination**: The process ends when the node finds the target or determines it's unreachable.

This process ensures logarithmic lookup time relative to the network size.

## Protocol Overview

The Kademlia protocol uses several message types for node interaction:

- **PING**: Check if a node is online and responsive.
- **STORE**: Instruct a node to store a key-value pair.
- **FIND_NODE**: Locate a node by its ID. Returns the k closest nodes.
- **FIND_VALUE**: Retrieve a key-value pair. If unavailable, returns the closest nodes to the key.
- **REPLY**: Response message to the above queries, containing the requested data or closer nodes.

## How This Implementation Works

This implementation includes the following features:

- **Routing Table Management**: Nodes maintain routing tables, organized into buckets based on XOR distance.
- **Bucket Management**: Buckets in this implementation are capped at 4 and for we use a 16 BIT keyspace.
- **Recursive Peer Lookup**: The recursive lookup mechanism allows efficient location of nodes and resources **(although their currently is a small bug for middle nodes in the keyspace name;y 3006 & 3007 where the last bucket contains the wrong nodes)**.
- **Storage and Retrieval**: Nodes store and retrieve key-value pairs, distributing data across the network using XOR distance.
- **TCP transport for brodcasting and direct messages**: I plan to implement a distributed ledgeer to this project at some point so i have set up TCP woth websockets for general message sharing

## Usage
to use this and run the keygen process yourself. first clone the repo run 
```bash
pnpm install
```
then in order to start the serice export a default env for the boostrap node 3000 (fake bootstrap) or and easier way is to open up a bash terminal and run the following commands to set up env vars (its recommended to run d=the dev script when testing or just trying out the service ```
```
export NODE_ENV=development PORT=3000
nvm use 18.20.0
pnpm start // for single node (prod script)

// or

pnpm run start:dev // to run 16 nodes concurrently (dev script)
```
You can then observe the peer doscvery process and begin to interact with each nodes HTTP API for getting node information and sending messages

### Other methods
note when using something like post man to call these GET endpoints. the http server is always deployed at port 2000 + nodeiD
```bash
GET- http://localhost:3001/getBucketNodes
```
returns a nodes buckets and all of the peers stored in each
```bash
GET- http://localhost:3001/store/value
```
stores a value on a given node
```bash
GET- http://localhost:3001/findValue/value
```
returns a previously stored value in he DHT

```bash
GET- http://localhost:3001/getNodeMessages
```
returns all TCP (Websocket) messages that a node has recieved

```bash
GET- http://localhost:3001/getNodeUdpMessages
```
returns all UDP node discovery messages that a node has recieved

```bash
POST- http://localhost:3001/postDirectMessage
```
send a direct message to a node

```bash
GET- http://localhost:3001/postBroadcastMessage
```
send a message to all peers of a given node. the message will propagate throughout the entire network when every node does this.

