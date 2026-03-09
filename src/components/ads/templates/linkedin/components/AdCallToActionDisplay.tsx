import React from 'react';

type AdCallToActionDisplayProps = {
  headline: string;
  companyName: string;
  ctaButtonText: string;
};

const AdCallToActionDisplay: React.FC<AdCallToActionDisplayProps> = ({
  headline,
  companyName,
  ctaButtonText,
}) => {
  return (
    <div className={`flex justify-between gap-2 px-4 py-3 bg-[#eef3f8]`}>
      <div className="flex items-center gap-2 justify-between w-full">
        <div className="text-sm text-gray-500">
          <strong className="text-black">{headline}</strong>
          <br />
          {/* Using a generic href for now, this could be a prop if needed */}
          <a href="#" className="text-gray-500 hover:underline">{companyName}</a>
        </div>
        <div>
          <button className={`bg-transparent text-[#3072ac] text-[14px] px-4 py-1 rounded-[34px] border border-[#3072ac] hover:bg-[#dde7f0]`}>
            {ctaButtonText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AdCallToActionDisplay;
