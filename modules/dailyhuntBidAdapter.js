import { registerBidder } from '../src/adapters/bidderFactory.js';
import * as mediaTypes from '../src/mediaTypes.js';
import * as utils from '../src/utils.js';
import { ajax } from '../src/ajax.js';

const BIDDER_CODE = 'dailyhunt';
const BIDDER_ALIAS = 'dh';
const SUPPORTED_MEDIA_TYPES = [mediaTypes.BANNER, mediaTypes.NATIVE, mediaTypes.VIDEO];

const PROD_PREBID_ENDPOINT_URL = 'http://dh2-van-qa-n1.dailyhunt.in:8000/openrtb2/auction';

const ORTB_NATIVE_TYPE_MAPPING = {
  img: {
    '3': 'image',
    '1': 'icon'
  },
  data: {
    '1': 'sponsoredBy',
    '2': 'body',
    '3': 'rating',
    '4': 'likes',
    '5': 'downloads',
    '6': 'price',
    '7': 'salePrice',
    '8': 'phone',
    '9': 'address',
    '10': 'body2',
    '11': 'displayUrl',
    '12': 'cta'
  }
}

const ORTB_NATIVE_PARAMS = {
  title: {
    id: 0,
    name: 'title'
  },
  icon: {
    id: 1,
    type: 1,
    name: 'img'
  },
  image: {
    id: 2,
    type: 3,
    name: 'img'
  },
  sponsoredBy: {
    id: 3,
    name: 'data',
    type: 1
  },
  body: {
    id: 4,
    name: 'data',
    type: 2
  },
  cta: {
    id: 5,
    type: 12,
    name: 'data'
  }
};

// Encode URI.
const _encodeURIComponent = function (a) {
  let b = window.encodeURIComponent(a);
  b = b.replace(/'/g, '%27');
  return b;
}

// Extract key from collections.
const extractKeyInfo = (collection, key) => {
  for (let i = 0, result; i < collection.length; i++) {
    result = utils.deepAccess(collection[i].params, key);
    if (result) {
      return result;
    }
  }
  return undefined
}

// Flattern Array.
const flatten = (arr) => {
  return [].concat(...arr);
}

const createOrtbRequest = (validBidRequests, bidderRequest) => {
  let device = createOrtbDeviceObj(validBidRequests);
  let user = createOrtbUserObj(validBidRequests)
  let site = createOrtbSiteObj(validBidRequests, bidderRequest.refererInfo.referer)
  return {
    id: bidderRequest.auctionId,
    imp: [],
    site,
    device,
    user,
  };
}

const createOrtbDeviceObj = (validBidRequests) => {
  let device = { ...extractKeyInfo(validBidRequests, `device`) };
  device.ua = navigator.userAgent;
  return device;
}

const createOrtbUserObj = (validBidRequests) => ({ ...extractKeyInfo(validBidRequests, `user`) })

const createOrtbSiteObj = (validBidRequests, page) => {
  let site = { ...extractKeyInfo(validBidRequests, `site`), page };
  let publisher = createOrtbPublisherObj(validBidRequests);
  if (publisher) {
    site.publisher = publisher
  }
  return site
}

const createOrtbPublisherObj = (validBidRequests) => ({ ...extractKeyInfo(validBidRequests, `publisher`) })

const createOrtbImpObj = (bid) => {
  let params = bid.params

  // Validate Banner Request.
  let bannerObj = utils.deepAccess(bid.mediaTypes, `banner`);
  let nativeObj = utils.deepAccess(bid.mediaTypes, `native`);
  let videoObj = utils.deepAccess(bid.mediaTypes, `video`);

  let imp = {
    id: bid.bidId,
    bidfloor: params.bidfloor ? params.bidfloor : 0,
    ext: {
      dailyhunt: {
        placement_id: params.placement_id,
        publisher_id: params.publisher_id
      }
    }
  };

  if (bannerObj) {
    imp.banner = {
      ...createOrtbImpBannerObj(bid, bannerObj)
    }
  } else if (nativeObj) {
    imp.native = {
      ...createOrtbImpNativeObj(bid, nativeObj)
    }
  } else if (videoObj) {
    imp.video = {
      ...createOrtbImpVideoObj(bid, videoObj)
    }
  }
  return imp;
}

const createOrtbImpBannerObj = (bid, bannerObj) => {
  let format = [];
  bannerObj.sizes.forEach(size => format.push({ w: size[0], h: size[1] }))

  return {
    id: 'banner-' + bid.bidId,
    format
  }
}

const createOrtbImpNativeObj = (bid, nativeObj) => {
  const assets = utils._map(bid.nativeParams, (bidParams, key) => {
    const props = ORTB_NATIVE_PARAMS[key];
    const asset = {
      required: bidParams.required & 1,
    };
    if (props) {
      let h = 0;
      let w = 0;

      asset.id = props.id;

      if (bidParams.sizes) {
        const sizes = flatten(bidParams.sizes);
        w = sizes[0];
        h = sizes[1];
      }

      asset[props.name] = {
        len: bidParams.len ? bidParams.len : 20,
        type: props.type,
        w,
        h
      };

      return asset;
    }
  }).filter(Boolean);
  let request = {
    assets,
    ver: '1,0'
  }
  return { request: JSON.stringify(request) };
}

const createOrtbImpVideoObj = (bid, videoObj) => ({
  ...videoObj,
  mimes: [
    'video/mp4'
  ]
})

const createServerRequest = (ortbRequest, validBidRequests) => ({
  method: 'POST',
  url: PROD_PREBID_ENDPOINT_URL,
  data: JSON.stringify(ortbRequest),
  options: {
    contentType: 'application/json',
    withCredentials: true
  },
  bids: validBidRequests
})

const createPrebidBannerBid = (bid, bidResponse) => ({
  requestId: bid.bidId,
  cpm: 1.4,
  creativeId: bidResponse.crid,
  width: 300,
  height: 250,
  ttl: 360,
  netRevenue: bid.netRevenue === 'net',
  currency: 'USD',
  ad: bidResponse.adm,
  mediaType: 'banner',
  winUrl: bidResponse.nurl
})

const createPrebidNativeBid = (bid, bidResponse) => ({
  requestId: bid.bidId,
  cpm: 1.4,
  creativeId: bidResponse.crid,
  currency: 'USD',
  ttl: 360,
  netRevenue: bid.netRevenue === 'net',
  native: parseNative(bidResponse),
  mediaType: 'native',
  winUrl: bidResponse.nurl
})

const parseNative = (bid) => {
  let adm = JSON.parse(bid.adm)
  const { assets, link, imptrackers, jstracker } = adm.native;
  const result = {
    clickUrl: _encodeURIComponent(link.url),
    clickTrackers: link.clicktrackers || [],
    impressionTrackers: imptrackers || [],
    javascriptTrackers: jstracker ? [ jstracker ] : []
  };
  assets.forEach(asset => {
    if (!utils.isEmpty(asset.title)) {
      result.title = asset.title.text
    } else if (!utils.isEmpty(asset.img)) {
      result[ORTB_NATIVE_TYPE_MAPPING.img[asset.img.type]] = {
        url: asset.img.url,
        height: asset.img.h,
        width: asset.img.w
      }
    } else if (!utils.isEmpty(asset.data)) {
      result[ORTB_NATIVE_TYPE_MAPPING.data[asset.data.type]] = asset.data.value
    }
  });

  return result;
}

const createPrebidVideoBid = (bid, bidResponse) => ({
  requestId: bid.bidId,
  cpm: 1.4,
  creativeId: bidResponse.crid,
  width: 300,
  height: 250,
  ttl: 360,
  netRevenue: bid.netRevenue === 'net',
  currency: 'USD',
  vastXml: bidResponse.adm.replace('4.0', '2.0'),
  mediaType: 'video',
  winUrl: bidResponse.nurl
})

export const spec = {
  code: BIDDER_CODE,

  aliases: [BIDDER_ALIAS],

  supportedMediaTypes: SUPPORTED_MEDIA_TYPES,

  isBidRequestValid: bid => !!bid.params.placement_id && !!bid.params.publisher_id,

  buildRequests: function (validBidRequests, bidderRequest) {
    let serverRequests = [];

    // ORTB Request.
    let ortbReq = createOrtbRequest(validBidRequests, bidderRequest);

    validBidRequests.forEach((bid) => {
      let imp = createOrtbImpObj(bid)
      ortbReq.imp.push(imp);
    });

    serverRequests.push({ ...createServerRequest(ortbReq, validBidRequests) });

    return serverRequests;
  },

  interpretResponse: function (serverResponse, request) {
    const { seatbid } = serverResponse.body;
    let bids = request.bids;
    return bids.reduce((accumulator, bid, index) => {
      const _cbid = seatbid && seatbid[0] && seatbid[0].bid;
      let bidResponse = _cbid && _cbid[index];

      if (bidResponse) {
        let bidMediaType = bidResponse.ext.prebid.type
        switch (bidMediaType) {
          case mediaTypes.BANNER:
            accumulator.push(createPrebidBannerBid(bid, bidResponse));
            break;
          case mediaTypes.NATIVE:
            accumulator.push(createPrebidNativeBid(bid, bidResponse));
            break;
          case mediaTypes.VIDEO:
            accumulator.push(createPrebidVideoBid(bid, bidResponse));
            break;
        }
      }
      return accumulator;
    }, []);
  },

  onBidWon: function(bid) {
    ajax(bid.winUrl, null, null, {
      withCredentials: true,
      method: 'GET',
      contentType: 'application/json'
    })
  }
}
registerBidder(spec);
