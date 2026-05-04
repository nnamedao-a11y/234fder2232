/**
 * SEO Collections Page
 * 
 * Landing page for SEO clusters (brand, model, budget)
 */

import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import axios from 'axios';
import { useLang } from '../../i18n';
import { 
  ArrowLeft,
  CarSimple,
  Fire,
  Timer,
  SpinnerGap,
  Warning,
  Tag
} from '@phosphor-icons/react';
import AuctionTimer from '../../components/public/AuctionTimer';

const API_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8001';

// ============ COLLECTIONS LIST ============

export const CollectionsPage = () => {
  const { t } = useLang();
  const [clusters, setClusters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeType, setActiveType] = useState('all');

  useEffect(() => {
    fetchClusters();
  }, []);

  const fetchClusters = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/seo-clusters/public`);
      setClusters(res.data || []);
    } catch (err) {
      console.error('Error fetching clusters:', err);
    } finally {
      setLoading(false);
    }
  };

  const types = [
    { key: 'all', label: 'Всі' },
    { key: 'brand', label: 'Бренди' },
    { key: 'model', label: 'Моделі' },
    { key: 'budget', label: 'Бюджет' },
    { key: 'bodyType', label: 'Тип кузова' },
  ];

  const filtered = activeType === 'all' 
    ? clusters 
    : clusters.filter(c => c.type === activeType);

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
        <SpinnerGap size={48} className="animate-spin text-zinc-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50" data-testid="collections-page">
      {/* Header */}
      <div className="bg-white border-b border-zinc-200">
        <div className="container mx-auto px-4 py-8">
          <h1 className="text-3xl font-bold text-zinc-900">Колекції авто</h1>
          <p className="text-zinc-500 mt-2">
            Знайдіть своє авто за брендом, моделлю або бюджетом
          </p>

          {/* Type Tabs */}
          <div className="flex gap-2 mt-6 overflow-x-auto pb-2">
            {types.map(t => (
              <button
                key={t.key}
                onClick={() => setActiveType(t.key)}
                className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                  activeType === t.key
                    ? 'bg-zinc-900 text-white'
                    : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Clusters Grid */}
      <div className="container mx-auto px-4 py-8">
        {filtered.length === 0 ? (
          <div className="text-center py-16">
            <Tag size={48} className="mx-auto text-zinc-300 mb-4" />
            <p className="text-zinc-500">Колекції не знайдено</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map(cluster => (
              <Link
                key={cluster.id || cluster.slug}
                to={`/collections/${cluster.slug}`}
                className="bg-white border border-zinc-200 rounded-xl p-6 hover:border-zinc-400 hover:shadow-sm transition-all group"
                data-testid={`cluster-${cluster.slug}`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="w-12 h-12 bg-zinc-100 rounded-lg flex items-center justify-center group-hover:bg-zinc-900 group-hover:text-white transition-colors">
                    <CarSimple size={24} />
                  </div>
                  <span className="text-sm text-zinc-400 bg-zinc-50 px-2 py-1 rounded">
                    {cluster.listingCount || 0} авто
                  </span>
                </div>
                <h3 className="font-semibold text-zinc-900 text-lg">
                  {cluster.title}
                </h3>
                <p className="text-sm text-zinc-500 mt-1 line-clamp-2">
                  {cluster.description}
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ============ SINGLE COLLECTION ============

export const CollectionDetailPage = () => {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchCluster();
  }, [slug]);

  const fetchCluster = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/seo-clusters/public/${slug}`);
      setData(res.data);
    } catch (err) {
      setError('Колекцію не знайдено');
      console.error('Error fetching cluster:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
        <SpinnerGap size={48} className="animate-spin text-zinc-400" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
        <div className="text-center">
          <Warning size={48} className="mx-auto text-amber-500 mb-4" />
          <h2 className="text-xl font-semibold text-zinc-900 mb-2">
            {error || 'Колекцію не знайдено'}
          </h2>
          <Link
            to="/collections"
            className="text-blue-600 hover:underline"
          >
            Переглянути всі колекції
          </Link>
        </div>
      </div>
    );
  }

  const { cluster, listings = [] } = data;

  return (
    <div className="min-h-screen bg-zinc-50" data-testid="collection-detail-page">
      {/* Header */}
      <div className="bg-white border-b border-zinc-200">
        <div className="container mx-auto px-4 py-4">
          <Link 
            to="/collections" 
            className="flex items-center gap-2 text-zinc-500 hover:text-zinc-900 transition-colors text-sm mb-4"
          >
            <ArrowLeft size={16} />
            Всі колекції
          </Link>
          
          <h1 className="text-3xl font-bold text-zinc-900">{cluster.title}</h1>
          <p className="text-zinc-500 mt-2">{cluster.description}</p>
          
          <div className="flex items-center gap-4 mt-4 text-sm text-zinc-500">
            <span>{listings.length} авто</span>
            {cluster.viewCount > 0 && (
              <span>{cluster.viewCount} переглядів</span>
            )}
          </div>
        </div>
      </div>

      {/* Listings Grid */}
      <div className="container mx-auto px-4 py-8">
        {listings.length === 0 ? (
          <div className="text-center py-16">
            <CarSimple size={48} className="mx-auto text-zinc-300 mb-4" />
            <p className="text-zinc-500">У цій колекції поки немає авто</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {listings.map(vehicle => (
              <VehicleCard key={vehicle.id || vehicle._id} vehicle={vehicle} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ============ VEHICLE CARD ============

const VehicleCard = ({ vehicle }) => {
  const displayTitle = vehicle.title || 
    `${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}`.trim() ||
    'Автомобіль';

  const price = vehicle.currentBid || vehicle.buyNowPrice || vehicle.estimatedRetail;
  const slug = vehicle.slug || vehicle.id || vehicle._id;
  const isHot = vehicle.rankingScore >= 0.65;

  return (
    <Link
      to={`/cars/${slug}`}
      className="bg-white border border-zinc-200 rounded-xl overflow-hidden hover:border-zinc-400 hover:shadow-md transition-all group"
      data-testid={`vehicle-card-${slug}`}
    >
      {/* Image */}
      <div className="aspect-[4/3] relative bg-zinc-100">
        {vehicle.images?.[0] ? (
          <img
            src={vehicle.images[0]}
            alt={displayTitle}
            className="w-full h-full object-cover"
            onError={(e) => { e.target.src = '/images/car-placeholder.jpg'; }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-zinc-300">
            <CarSimple size={48} />
          </div>
        )}

        {/* Badges */}
        <div className="absolute top-3 left-3 flex gap-2">
          {isHot && (
            <span className="bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full flex items-center gap-1">
              <Fire size={12} weight="fill" />
              HOT
            </span>
          )}
        </div>

        {/* Timer */}
        {vehicle.auctionDate && new Date(vehicle.auctionDate) > new Date() && (
          <div className="absolute bottom-3 right-3">
            <div className="bg-black/70 text-white text-xs px-2 py-1 rounded-lg flex items-center gap-1">
              <Timer size={12} />
              <AuctionTimer date={vehicle.auctionDate} compact />
            </div>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-4">
        <h3 className="font-semibold text-zinc-900 group-hover:text-zinc-700 line-clamp-1">
          {displayTitle}
        </h3>

        <div className="flex items-center gap-2 mt-2 text-sm text-zinc-500">
          {vehicle.mileage && (
            <span>{vehicle.mileage.toLocaleString()} mi</span>
          )}
          {vehicle.location && (
            <>
              <span>•</span>
              <span className="truncate">{vehicle.location}</span>
            </>
          )}
        </div>

        {price && (
          <div className="mt-3 flex items-center justify-between">
            <span className="text-lg font-bold text-zinc-900">
              ${price.toLocaleString()}
            </span>
            {vehicle.source && (
              <span className="text-xs text-zinc-400 uppercase">
                {vehicle.source}
              </span>
            )}
          </div>
        )}
      </div>
    </Link>
  );
};

export default CollectionsPage;
