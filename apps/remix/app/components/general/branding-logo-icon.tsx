import LogoIconImage from '@documenso/assets/logo_icon.png';
import type { ImgHTMLAttributes } from 'react';

export type LogoProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt'>;

/**
 * Square SmartRoofing AI mark for compact placements (mobile headers, cards).
 */
export const BrandingLogoIcon = ({ className, ...props }: LogoProps) => {
  return <img src={LogoIconImage} alt="SmartRoofing AI" className={className} {...props} />;
};
